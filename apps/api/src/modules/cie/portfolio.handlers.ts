/**
 * /v1/portfolio HTTP handlers — M09 Step 5 public portfolio generation.
 *
 * Autonomy boundary (architecture.md §5 / api-spec.md §Portfolio):
 *   - POST /v1/portfolio           (generate/update draft) → GREEN — the
 *     PortfolioService composes strictly from REAL profile facts + projects +
 *     graph evidence (via ports) and self-verifies zero fabrication before
 *     persist. The draft stays PRIVATE.
 *   - GET  /v1/portfolio           (owner view)            → GREEN — read-only.
 *   - POST /v1/portfolio/publish                           → YELLOW — the
 *     controller wraps this handler in withCapabilityGate('portfolio.publish')
 *     so a valid single-use ApprovalToken is REQUIRED (and the gate audits the
 *     decision) before the handler body ever runs. Publishing freezes the
 *     current draft into `publishedContent` — the ONLY payload public reads
 *     may serve.
 *   - PUBLIC READ (getPublicPortfolio) serves ONLY status='published' rows'
 *     frozen snapshot. PRIVATE BY DEFAULT: a not-yet-published portfolio is
 *     never publicly readable — the lookup itself filters on published.
 *
 * Handlers are DB-free; persistence sits behind the narrow PortfolioStorePort.
 */
import { randomUUID } from 'node:crypto';
import type { PortfolioContent, PortfolioService } from '@careeros/cie-portfolio';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';

// ---------- DTOs ----------

/** A persisted portfolio row as stored (per-user via userId). */
export interface PortfolioRecord {
  id: string;
  userId: string;
  status: 'private' | 'published';
  slug: string;
  /** Current generator draft — owner-only until published. */
  content: PortfolioContent;
  /** Frozen snapshot the public read serves; null until first publish. */
  publishedContent: PortfolioContent | null;
  publishedAt: string | null;
  modelVersion: string;
  generatedAt: string;
}

/** Owner view — strips userId (per-user scoping is a server concern). */
export type PortfolioDto = Omit<PortfolioRecord, 'userId'>;

/** Public view — ONLY the frozen published snapshot + handle. */
export interface PublicPortfolioDto {
  slug: string;
  content: PortfolioContent;
  publishedAt: string;
}

// ---------- ports ----------

export interface PortfolioStorePort {
  /** Upsert the user's single portfolio draft (status untouched on update). */
  upsertDraft(record: PortfolioRecord): Promise<PortfolioRecord>;
  findByUser(userId: string): Promise<PortfolioRecord | null>;
  /** Freeze the draft: status=published, publishedContent=content snapshot. */
  publish(userId: string, publishedAt: string): Promise<PortfolioRecord | null>;
  /** PUBLIC lookup — MUST return only status='published' rows. */
  findPublishedBySlug(slug: string): Promise<PortfolioRecord | null>;
}

export interface PortfolioHandlerDeps {
  service: PortfolioService;
  store: PortfolioStorePort;
  now?: () => Date;
}

// ---------- in-memory store (until a Prisma PortfolioStore lands) ----------

export class InMemoryPortfolioStore implements PortfolioStorePort {
  private readonly rows = new Map<string, PortfolioRecord>(); // by userId

  upsertDraft(record: PortfolioRecord): Promise<PortfolioRecord> {
    const existing = this.rows.get(record.userId);
    const merged: PortfolioRecord = existing
      ? {
          ...existing,
          content: record.content,
          modelVersion: record.modelVersion,
          generatedAt: record.generatedAt,
        }
      : record;
    this.rows.set(record.userId, merged);
    return Promise.resolve(merged);
  }

  findByUser(userId: string): Promise<PortfolioRecord | null> {
    return Promise.resolve(this.rows.get(userId) ?? null);
  }

  publish(userId: string, publishedAt: string): Promise<PortfolioRecord | null> {
    const row = this.rows.get(userId);
    if (!row) return Promise.resolve(null);
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
      // PRIVATE BY DEFAULT: only published rows are publicly resolvable.
      if (row.slug === slug && row.status === 'published') return Promise.resolve(row);
    }
    return Promise.resolve(null);
  }
}

// ---------- POST /v1/portfolio — generate/update draft (GREEN) ----------

export async function generatePortfolioDraft(
  ctx: RequestContext,
  deps: PortfolioHandlerDeps,
): Promise<HandlerResponse<PortfolioDto>> {
  // Green: the service composes from real port-supplied facts and throws
  // PortfolioIntegrityError if the zero-fabrication oracle rejects — nothing
  // unverified is ever persisted.
  const content = await deps.service.generate(ctx.userId);

  const now = (deps.now ?? (() => new Date()))();
  const record = await deps.store.upsertDraft({
    id: randomUUID(),
    userId: ctx.userId,
    status: 'private', // private by default; only the Yellow publish flips it
    slug: `u-${ctx.userId.slice(0, 8)}-${randomUUID().slice(0, 8)}`,
    content,
    publishedContent: null,
    publishedAt: null,
    modelVersion: content.modelVersion,
    generatedAt: now.toISOString(),
  });
  return ok(toDto(record));
}

// ---------- GET /v1/portfolio — owner view (GREEN) ----------

export async function getOwnPortfolio(
  ctx: RequestContext,
  deps: PortfolioHandlerDeps,
): Promise<HandlerResponse<PortfolioDto>> {
  const record = await deps.store.findByUser(ctx.userId);
  if (!record) {
    return errorResponse('not_found', 'No portfolio generated yet.', {
      details: { hint: 'POST /v1/portfolio to generate a draft.' },
      traceId: ctx.traceId,
    });
  }
  return ok(toDto(record));
}

// ---------- POST /v1/portfolio/publish (YELLOW — gate runs BEFORE this handler) ----------

/**
 * Executes AFTER withCapabilityGate('portfolio.publish') has verified +
 * consumed a single-use ApprovalToken (the gate audits the decision).
 * Freezes the current draft into the public snapshot.
 */
export async function publishPortfolio(
  ctx: RequestContext,
  deps: PortfolioHandlerDeps,
): Promise<HandlerResponse<PortfolioDto>> {
  const existing = await deps.store.findByUser(ctx.userId);
  if (!existing) {
    return errorResponse('not_found', 'No portfolio to publish — generate a draft first.', {
      details: { hint: 'POST /v1/portfolio to generate a draft.' },
      traceId: ctx.traceId,
    });
  }
  const publishedAt = (deps.now ?? (() => new Date()))().toISOString();
  const updated = await deps.store.publish(ctx.userId, publishedAt);
  return ok(toDto(updated ?? existing));
}

// ---------- GET /v1/portfolio/public/:slug — public read (published ONLY) ----------

/**
 * Public read: NO auth context — serves ONLY the frozen `publishedContent` of
 * a status='published' portfolio. Unpublished (private) portfolios 404: the
 * store lookup itself filters on published, so private data cannot leak even
 * if the slug is guessed.
 */
export async function getPublicPortfolio(
  slug: string,
  deps: PortfolioHandlerDeps,
): Promise<HandlerResponse<PublicPortfolioDto>> {
  const record = await deps.store.findPublishedBySlug(slug);
  if (!record || record.publishedContent === null || record.publishedAt === null) {
    return errorResponse('not_found', 'Portfolio not found.', {
      details: { slug },
    });
  }
  return ok({
    slug: record.slug,
    content: record.publishedContent,
    publishedAt: record.publishedAt,
  });
}

// ---------- helpers ----------

function toDto(record: PortfolioRecord): PortfolioDto {
  const { userId: _userId, ...dto } = record;
  return dto;
}