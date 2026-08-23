/** Contract-shaped /v1/portfolio handlers with private-by-default publication. */
import { randomUUID } from 'node:crypto';
import type { PortfolioService } from '@careeros/cie-portfolio';
import {
  portfolioContentSchema,
  portfolioGenerateRequestSchema,
  portfolioGenerateResponseSchema,
  portfolioPublishRequestSchema,
  portfolioPublishResponseSchema,
  portfolioPublishTokenRequestSchema,
  portfolioPublishTokenResponseSchema,
  portfolioResponseSchema,
  publicPortfolioResponseSchema,
  type PortfolioContent,
  type PortfolioGenerateResponse,
  type PortfolioPublishResponse,
  type PortfolioPublishTokenResponse,
  type PortfolioResponse,
  type PublicPortfolioResponse,
  type ReadyPortfolioContent,
} from '@careeros/contracts';
import { hashPayload, mintApprovalToken, type EnforceDeps } from '@careeros/capability-gate';
import type { UserAutonomyResolver } from '../../common/capability-gate/gate-interceptor.js';
import { withCapabilityGate } from '../../common/capability-gate/gate-interceptor.js';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';

export const PORTFOLIO_PUBLISH_ACTION = 'portfolio.publish' as const;
export const DEFAULT_PORTFOLIO_APPROVAL_TTL_MS = 15 * 60 * 1000;

/** Internal persistence shape. It must never be returned from an HTTP handler. */
export interface PortfolioRecord {
  id: string;
  userId: string;
  status: 'private' | 'published';
  slug: string;
  content: PortfolioContent;
  publishedContent: PortfolioContent | null;
  publishedAt: string | null;
  generatedAt: string;
}

export interface PortfolioStorePort {
  upsertDraft(record: PortfolioRecord): Promise<PortfolioRecord>;
  findByUser(userId: string): Promise<PortfolioRecord | null>;
  /** Atomically freeze only the exact draft that passed token verification. */
  publishIfContentMatches(
    userId: string,
    expectedContentHash: string,
    publishedAt: string,
  ): Promise<PortfolioRecord | null>;
  findPublishedBySlug(slug: string): Promise<PortfolioRecord | null>;
}

export interface PortfolioHandlerDeps {
  service: PortfolioService;
  store: PortfolioStorePort;
  now?: () => Date;
  approvalTtlMs?: number;
}

export class InMemoryPortfolioStore implements PortfolioStorePort {
  private readonly rows = new Map<string, PortfolioRecord>();

  upsertDraft(record: PortfolioRecord): Promise<PortfolioRecord> {
    const existing = this.rows.get(record.userId);
    const merged: PortfolioRecord = existing
      ? { ...existing, content: record.content, generatedAt: record.generatedAt }
      : record;
    this.rows.set(record.userId, merged);
    return Promise.resolve(merged);
  }

  findByUser(userId: string): Promise<PortfolioRecord | null> {
    return Promise.resolve(this.rows.get(userId) ?? null);
  }

  publishIfContentMatches(
    userId: string,
    expectedContentHash: string,
    publishedAt: string,
  ): Promise<PortfolioRecord | null> {
    const row = this.rows.get(userId);
    if (!row || hashPayload(row.content) !== expectedContentHash) return Promise.resolve(null);
    const updated: PortfolioRecord = {
      ...row,
      status: 'published',
      publishedContent: row.content,
      publishedAt,
    };
    this.rows.set(userId, updated);
    return Promise.resolve(updated);
  }

  findPublishedBySlug(slug: string): Promise<PortfolioRecord | null> {
    for (const row of this.rows.values()) {
      if (row.slug === slug && row.status === 'published') return Promise.resolve(row);
    }
    return Promise.resolve(null);
  }
}

/** POST /v1/portfolio — generate/update the caller's private draft. */
export async function generatePortfolioDraft(
  ctx: RequestContext,
  body: unknown,
  deps: PortfolioHandlerDeps,
): Promise<HandlerResponse<PortfolioGenerateResponse>> {
  const request = portfolioGenerateRequestSchema.safeParse(body);
  if (!request.success) return invalid(ctx, 'Invalid portfolio generation request.');

  const content = portfolioContentSchema.parse(await deps.service.generate(ctx.userId));
  const at = now(deps);
  const record = await deps.store.upsertDraft({
    id: randomUUID(),
    userId: ctx.userId,
    status: 'private',
    slug: `u-${ctx.userId.slice(0, 8)}-${randomUUID().slice(0, 8)}`,
    content,
    publishedContent: null,
    publishedAt: null,
    generatedAt: at.toISOString(),
  });
  return ok(portfolioGenerateResponseSchema.parse(toOwnerResponse(record)));
}

/** GET /v1/portfolio — owner-scoped current draft and publication metadata. */
export async function getOwnPortfolio(
  ctx: RequestContext,
  deps: PortfolioHandlerDeps,
): Promise<HandlerResponse<PortfolioResponse>> {
  const record = await deps.store.findByUser(ctx.userId);
  if (!record) return noPortfolio(ctx);
  return ok(portfolioResponseSchema.parse(toOwnerResponse(record)));
}

/**
 * POST /v1/portfolio/publish/mint — deliberate user confirmation over the
 * exact authoritative draft. It is Green, accepts no content, and never needs
 * a token merely to mint a token.
 */
export async function mintPortfolioPublishToken(
  ctx: RequestContext,
  body: unknown,
  deps: PortfolioHandlerDeps,
  gate: EnforceDeps,
): Promise<HandlerResponse<PortfolioPublishTokenResponse>> {
  const request = portfolioPublishTokenRequestSchema.safeParse(body);
  if (!request.success) return invalid(ctx, 'Invalid portfolio publish confirmation request.');
  const record = await deps.store.findByUser(ctx.userId);
  if (!record) return noPortfolio(ctx);
  if (record.content.status !== 'ready') return insufficientToPublish(ctx);

  const at = now(deps);
  const ttlMs = deps.approvalTtlMs ?? DEFAULT_PORTFOLIO_APPROVAL_TTL_MS;
  const token = await mintApprovalToken({
    userId: ctx.userId,
    action: PORTFOLIO_PUBLISH_ACTION,
    payload: record.content,
    ttlMs,
    secret: gate.secret,
    store: gate.tokenStore,
    now: () => at.getTime(),
  });
  await gate.audit.append({
    userId: ctx.userId,
    actor: 'user',
    action: 'approval.mint',
    target: PORTFOLIO_PUBLISH_ACTION,
    reason: 'Single-use token minted for the exact current portfolio content hash.',
    modelVersion: record.content.modelVersion,
    traceId: ctx.traceId,
  });
  return ok(portfolioPublishTokenResponseSchema.parse({
    token,
    expiresAt: new Date(at.getTime() + ttlMs).toISOString(),
    action: PORTFOLIO_PUBLISH_ACTION,
    payloadHash: hashPayload(record.content),
    slug: record.slug,
    content: record.content,
  }));
}

/**
 * POST /v1/portfolio/publish — reload current content, verify and consume the
 * token against that exact content, then atomically freeze only that content.
 */
export async function publishPortfolio(
  ctx: RequestContext,
  body: unknown,
  deps: PortfolioHandlerDeps,
  gate: EnforceDeps,
  resolveUserTier?: UserAutonomyResolver,
): Promise<HandlerResponse<PortfolioPublishResponse>> {
  const request = portfolioPublishRequestSchema.safeParse(body);
  if (!request.success) return invalid(ctx, 'Invalid portfolio publish request.');
  const record = await deps.store.findByUser(ctx.userId);
  if (!record) return noPortfolio(ctx);
  if (record.content.status !== 'ready') return insufficientToPublish(ctx);

  const content = record.content;
  const expectedContentHash = hashPayload(content);
  const gated = withCapabilityGate<ReadyPortfolioContent, PortfolioPublishResponse>(
    PORTFOLIO_PUBLISH_ACTION,
    gate,
    async (gatedCtx) => {
      const publishedAt = now(deps).toISOString();
      const updated = await deps.store.publishIfContentMatches(
        gatedCtx.userId,
        expectedContentHash,
        publishedAt,
      );
      if (!updated || updated.publishedContent?.status !== 'ready' || updated.publishedAt === null) {
        return errorResponse('conflict', 'Portfolio changed after confirmation; review and confirm it again.', {
          details: { reason: 'payload_mismatch' },
          traceId: gatedCtx.traceId,
        });
      }
      return ok(portfolioPublishResponseSchema.parse({
        content: updated.publishedContent,
        publishStatus: 'published',
        slug: updated.slug,
        publishedAt: updated.publishedAt,
        hasPublishedSnapshot: true,
      }));
    },
    resolveUserTier,
  );
  return gated(ctx, content);
}

/** GET /v1/portfolio/public/:slug — frozen, published content only. */
export async function getPublicPortfolio(
  slug: string,
  deps: PortfolioHandlerDeps,
): Promise<HandlerResponse<PublicPortfolioResponse>> {
  const record = await deps.store.findPublishedBySlug(slug);
  if (!record || record.publishedContent?.status !== 'ready' || record.publishedAt === null) {
    return errorResponse('not_found', 'Portfolio not found.', { details: { slug } });
  }
  return ok(publicPortfolioResponseSchema.parse({
    slug: record.slug,
    content: record.publishedContent,
    publishedAt: record.publishedAt,
  }));
}

function now(deps: PortfolioHandlerDeps): Date {
  return (deps.now ?? (() => new Date()))();
}

function toOwnerResponse(record: PortfolioRecord): PortfolioResponse {
  const hasPublishedSnapshot = record.publishedContent?.status === 'ready' && record.publishedAt !== null;
  return portfolioResponseSchema.parse({
    content: record.content,
    publishStatus: hasPublishedSnapshot ? 'published' : 'private',
    slug: record.slug,
    publishedAt: hasPublishedSnapshot ? record.publishedAt : null,
    hasPublishedSnapshot,
  });
}

function invalid(ctx: RequestContext, message: string): HandlerResponse<never> {
  return errorResponse('validation_failed', message, { traceId: ctx.traceId });
}

function noPortfolio(ctx: RequestContext): HandlerResponse<never> {
  return errorResponse('not_found', 'No portfolio generated yet.', {
    details: { hint: 'POST /v1/portfolio to generate a draft.' },
    traceId: ctx.traceId,
  });
}

function insufficientToPublish(ctx: RequestContext): HandlerResponse<never> {
  return errorResponse('conflict', 'This portfolio has insufficient grounded content to publish.', {
    details: { reason: 'insufficient_data' },
    traceId: ctx.traceId,
  });
}