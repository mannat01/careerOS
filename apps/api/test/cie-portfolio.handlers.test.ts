import { beforeEach, describe, expect, it } from 'vitest';
import { createAuditClient, InMemoryAuditSink } from '@careeros/observability';
import { InMemoryApprovalTokenStore, type EnforceDeps } from '@careeros/capability-gate';
import {
  apiErrorSchema,
  portfolioGenerateResponseSchema,
  portfolioPublishResponseSchema,
  portfolioPublishTokenResponseSchema,
  portfolioResponseSchema,
  publicPortfolioResponseSchema,
  type PortfolioGenerateResponse,
} from '@careeros/contracts';
import { PortfolioService } from '@careeros/cie-portfolio';
import { contextFromVerifiedClaims } from '../src/index.js';
import {
  generatePortfolioDraft,
  getOwnPortfolio,
  getPublicPortfolio,
  InMemoryPortfolioStore,
  mintPortfolioPublishToken,
  publishPortfolio,
  type PortfolioHandlerDeps,
} from '../src/modules/cie/portfolio.handlers.js';

const USER_A = 'user-a';
const USER_B = 'user-b';
const SECRET = 'portfolio-secret';
const NOW = new Date('2026-08-23T12:00:00.000Z');
const ALLOWED = ['fact-exp-1', 'fact-skill-ts', 'proj-1', 'node-skill-ts'];

function makeService(version: { value: number }): PortfolioService {
  return new PortfolioService({
    profile: {
      readProfileHeader: () => Promise.resolve({
        headline: { text: `Senior Engineer v${version.value}`, factRefs: ['fact-exp-1'] },
        summary: { text: 'Backend and platform work.', factRefs: ['fact-exp-1'] },
      }),
      readProfileFacts: () => Promise.resolve([
        { id: 'fact-exp-1', kind: 'experience', summary: 'Senior Engineer at Acme' },
        { id: 'fact-skill-ts', kind: 'skill', summary: 'TypeScript' },
      ]),
    },
    projects: {
      readProjects: () => Promise.resolve([{
        id: 'proj-1',
        name: `Realtime Analytics Pipeline v${version.value}`,
        description: `Caller-recorded project version ${version.value}.`,
        skills: ['TypeScript'],
      }]),
    },
    graph: {
      readGraphEvidence: () => Promise.resolve([
        { id: 'node-skill-ts', kind: 'skill', label: 'TypeScript' },
      ]),
    },
    evidence: { readAllowedFactRefs: () => Promise.resolve(ALLOWED) },
  });
}

describe('FM6.6-pre portfolio handlers', () => {
  let version: { value: number };
  let deps: PortfolioHandlerDeps;
  let gate: EnforceDeps;
  const ctxA = contextFromVerifiedClaims({ userId: USER_A, traceId: 'trace-a', headers: {} });
  const ctxB = contextFromVerifiedClaims({ userId: USER_B, traceId: 'trace-b', headers: {} });

  beforeEach(() => {
    version = { value: 1 };
    deps = {
      service: makeService(version),
      store: new InMemoryPortfolioStore(),
      now: () => NOW,
      approvalTtlMs: 60_000,
    };
    gate = {
      secret: SECRET,
      tokenStore: new InMemoryApprovalTokenStore(),
      audit: createAuditClient({ sink: new InMemoryAuditSink(), clock: () => NOW }),
      now: () => NOW.getTime(),
    };
  });

  async function generate(ctx = ctxA): Promise<PortfolioGenerateResponse> {
    const response = await generatePortfolioDraft(ctx, {}, deps);
    expect(response.status).toBe(200);
    return portfolioGenerateResponseSchema.parse(response.body);
  }

  async function mint(ctx = ctxA) {
    const response = await mintPortfolioPublishToken(ctx, {}, deps, gate);
    expect(response.status).toBe(200);
    return portfolioPublishTokenResponseSchema.parse(response.body);
  }

  function withToken(ctx: typeof ctxA, token: string): typeof ctxA {
    return contextFromVerifiedClaims({
      userId: ctx.userId,
      traceId: ctx.traceId,
      headers: { 'x-approval-token': token },
    });
  }

  it('returns a contract-shaped owner response that is private by default', async () => {
    const generated = await generate();
    expect(generated.publishStatus).toBe('private');
    expect(generated.publishedAt).toBeNull();
    expect(generated.hasPublishedSnapshot).toBe(false);
    expect(generated).not.toHaveProperty('userId');
    expect(generated).not.toHaveProperty('publishedContent');
    expect(generated.content.status).toBe('ready');
    if (generated.content.status !== 'ready') throw new Error('Expected ready portfolio.');
    for (const item of [...generated.content.projects, ...generated.content.skills]) {
      expect(item.factRefs.length).toBeGreaterThan(0);
      for (const ref of item.factRefs) expect(ALLOWED).toContain(ref);
    }

    const owner = await getOwnPortfolio(ctxA, deps);
    expect(portfolioResponseSchema.parse(owner.body)).toEqual(generated);
  });

  it('unpublished content is not publicly readable even with the exact slug', async () => {
    const generated = await generate();
    const response = await getPublicPortfolio(generated.slug, deps);
    expect(response.status).toBe(404);
    expect(apiErrorSchema.parse(response.body).error.code).toBe('not_found');
  });

  it('mints without a prior token and publishes the exact preview once; replay is refused', async () => {
    const generated = await generate();
    const withoutToken = await publishPortfolio(ctxA, {}, deps, gate);
    expect(withoutToken.status).toBe(403);
    expect((await getPublicPortfolio(generated.slug, deps)).status).toBe(404);

    const grant = await mint();
    expect(grant.content).toEqual(generated.content);
    expect(grant.action).toBe('portfolio.publish');

    const ctx = withToken(ctxA, grant.token);
    const publishedResponse = await publishPortfolio(ctx, {}, deps, gate);
    expect(publishedResponse.status).toBe(200);
    const published = portfolioPublishResponseSchema.parse(publishedResponse.body);
    expect(published.content).toEqual(grant.content);
    expect(published.hasPublishedSnapshot).toBe(true);

    const replay = await publishPortfolio(ctx, {}, deps, gate);
    expect(replay.status).toBe(403);
    expect(apiErrorSchema.parse(replay.body).error.details?.['reason']).toBe('approval_already_consumed');

    const publicView = await getPublicPortfolio(generated.slug, deps);
    expect(publicView.status).toBe(200);
    expect(publicPortfolioResponseSchema.parse(publicView.body)).toEqual({
      slug: generated.slug,
      content: grant.content,
      publishedAt: NOW.toISOString(),
    });
  });

  it('refuses a token after draft regeneration changes the exact content', async () => {
    await generate();
    const grant = await mint();
    version.value = 2;
    const changed = await generate();
    expect(changed.content).not.toEqual(grant.content);

    const response = await publishPortfolio(withToken(ctxA, grant.token), {}, deps, gate);
    expect(response.status).toBe(403);
    expect(apiErrorSchema.parse(response.body).error.details?.['reason']).toBe('approval_payload_mismatch');
    const owner = portfolioResponseSchema.parse((await getOwnPortfolio(ctxA, deps)).body);
    expect(owner.hasPublishedSnapshot).toBe(false);
  });

  it('post-publish draft edits never leak into the frozen public snapshot', async () => {
    const generated = await generate();
    const grant = await mint();
    const published = await publishPortfolio(withToken(ctxA, grant.token), {}, deps, gate);
    expect(published.status).toBe(200);

    version.value = 2;
    const edited = await generate();
    expect(edited.content).not.toEqual(grant.content);
    expect(edited.hasPublishedSnapshot).toBe(true);

    const publicView = publicPortfolioResponseSchema.parse(
      (await getPublicPortfolio(generated.slug, deps)).body,
    );
    expect(publicView.content).toEqual(grant.content);
    expect(publicView.content).not.toEqual(edited.content);
    expect(publicView).not.toHaveProperty('draft');
    expect(publicView).not.toHaveProperty('hasPublishedSnapshot');
  });

  it('isolates owner reads and token redemption across users', async () => {
    const portfolioA = await generate(ctxA);
    const grantA = await mint(ctxA);
    const portfolioB = await generate(ctxB);
    expect(portfolioB.slug).not.toBe(portfolioA.slug);

    const ownerB = portfolioResponseSchema.parse((await getOwnPortfolio(ctxB, deps)).body);
    expect(ownerB.slug).toBe(portfolioB.slug);

    const crossUser = await publishPortfolio(withToken(ctxB, grantA.token), {}, deps, gate);
    expect(crossUser.status).toBe(403);
    expect(apiErrorSchema.parse(crossUser.body).error.details?.['reason']).toBe('approval_wrong_user');
    expect((await getPublicPortfolio(portfolioA.slug, deps)).status).toBe(404);
    expect((await getPublicPortfolio(portfolioB.slug, deps)).status).toBe(404);
  });

  it('rejects client-authored generation, mint, and publish payloads', async () => {
    expect((await generatePortfolioDraft(ctxA, { userId: USER_B }, deps)).status).toBe(422);
    await generate();
    expect((await mintPortfolioPublishToken(ctxA, { content: 'replacement' }, deps, gate)).status).toBe(422);
    const grant = await mint();
    expect((await publishPortfolio(
      withToken(ctxA, grant.token),
      { content: grant.content },
      deps,
      gate,
    )).status).toBe(422);
  });
});