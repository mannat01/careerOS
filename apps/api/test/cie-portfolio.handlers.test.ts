/**
 * /v1/portfolio handler tests — M09 Step 5.
 *
 * Proves the Stage-9 portfolio invariants at the HTTP boundary:
 *   1. GREEN generate: every rendered item resolves to a real fact (zero
 *      fabrication), and the result is PRIVATE by default.
 *   2. GREEN owner read: per-user scoped.
 *   3. YELLOW publish: withCapabilityGate('portfolio.publish') denies without
 *      an ApprovalToken (audited, nothing published); a valid single-use token
 *      publishes exactly once (replay denied).
 *   4. PRIVATE BY DEFAULT: the public read 404s for unpublished portfolios —
 *      even with the correct slug — and serves ONLY the frozen published
 *      snapshot after publish.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryApprovalTokenStore,
  mintApprovalToken,
  type EnforceDeps,
} from '@careeros/capability-gate';
import { createAuditClient, InMemoryAuditSink } from '@careeros/observability';
import type { ApiError } from '@careeros/contracts';
import { PortfolioService } from '@careeros/cie-portfolio';
import { contextFromVerifiedClaims, withCapabilityGate } from '../src/index.js';
import {
  generatePortfolioDraft,
  getOwnPortfolio,
  getPublicPortfolio,
  publishPortfolio,
  InMemoryPortfolioStore,
  type PortfolioDto,
  type PortfolioHandlerDeps,
  type PublicPortfolioDto,
} from '../src/modules/cie/portfolio.handlers.js';

const USER_A = 'user-a';
const USER_B = 'user-b';
const SECRET = 'portfolio-secret';
const NOW = new Date('2026-07-22T12:00:00.000Z');

const FACTS = [
  { id: 'fact-exp-1', kind: 'experience' as const, summary: 'Senior Engineer at Acme (2020–2024)' },
  { id: 'fact-skill-ts', kind: 'skill' as const, summary: 'TypeScript' },
];
const PROJECTS = [
  {
    id: 'proj-1',
    name: 'Realtime Analytics Pipeline',
    description: 'Streaming pipeline processing events at Acme.',
    skills: ['TypeScript', 'Kafka'],
  },
];
const GRAPH = [
  { id: 'node-skill-ts', kind: 'skill' as const, label: 'TypeScript' },
  { id: 'node-outcome-1', kind: 'outcome' as const, label: 'Cut p95 latency', metric: 'p95 -40%' },
];
const ALLOWED = [...FACTS.map((f) => f.id), ...PROJECTS.map((p) => p.id), ...GRAPH.map((g) => g.id)];

function makeService(): PortfolioService {
  return new PortfolioService({
    profile: {
      readProfileHeader: () =>
        Promise.resolve({ headline: 'Senior Engineer', summary: 'Backend + platform work.' }),
      readProfileFacts: () => Promise.resolve(FACTS),
    },
    projects: { readProjects: () => Promise.resolve(PROJECTS) },
    graph: { readGraphEvidence: () => Promise.resolve(GRAPH) },
    evidence: { readAllowedFactRefs: () => Promise.resolve(ALLOWED) },
  });
}

describe('/v1/portfolio handlers (generate Green, publish Yellow, private by default)', () => {
  let deps: PortfolioHandlerDeps;
  let auditSink: InMemoryAuditSink;
  let tokenStore: InMemoryApprovalTokenStore;
  let gateDeps: EnforceDeps;

  const ctxA = contextFromVerifiedClaims({ userId: USER_A, traceId: 'trace-a', headers: {} });

  beforeEach(() => {
    deps = {
      service: makeService(),
      store: new InMemoryPortfolioStore(),
      now: () => NOW,
    };
    auditSink = new InMemoryAuditSink();
    tokenStore = new InMemoryApprovalTokenStore();
    gateDeps = {
      secret: SECRET,
      tokenStore,
      audit: createAuditClient({ sink: auditSink, clock: () => NOW }),
      now: () => NOW.getTime(),
    };
  });

  /** The publish route exactly as the controller wires it: gate BEFORE handler. */
  const publishRoute = () =>
    withCapabilityGate<Record<string, never>, PortfolioDto>('portfolio.publish', gateDeps, (ctx) =>
      publishPortfolio(ctx, deps),
    );

  async function generateOne(): Promise<PortfolioDto> {
    const res = await generatePortfolioDraft(ctxA, deps);
    expect(res.status).toBe(200);
    return res.body as PortfolioDto;
  }

  // ---------- POST /v1/portfolio (GREEN, zero fabrication, private) ----------

  it('generates a draft where every rendered item resolves to a real fact; private by default', async () => {
    const dto = await generateOne();

    expect(dto.status).toBe('private'); // private by default
    expect(dto.publishedContent).toBeNull();
    expect(dto.publishedAt).toBeNull();
    expect(dto.content.projects.length).toBeGreaterThan(0);
    expect(dto.content.skills.length).toBeGreaterThan(0);
    // Zero-fabrication: every factRef on every rendered item is on the
    // sanctioned allow-list of REAL fact/project/graph ids.
    for (const item of dto.content.projects) {
      expect(item.factRefs.length).toBeGreaterThan(0);
      for (const ref of item.factRefs) expect(ALLOWED).toContain(ref);
    }
    for (const s of dto.content.skills) {
      expect(s.factRefs.length).toBeGreaterThan(0);
      for (const ref of s.factRefs) expect(ALLOWED).toContain(ref);
    }
    // No invented projects: only the real project name renders.
    for (const item of dto.content.projects) {
      expect(item.title).toBe('Realtime Analytics Pipeline');
    }
  });

  it('regenerating updates the draft in place without touching publish state', async () => {
    const first = await generateOne();
    const second = await generateOne();
    expect(second.slug).toBe(first.slug); // stable identity across updates
    expect(second.status).toBe('private');
  });

  // ---------- GET /v1/portfolio (GREEN, per-user) ----------

  it('owner view returns own portfolio; another user gets not_found', async () => {
    await generateOne();

    const mine = await getOwnPortfolio(ctxA, deps);
    expect(mine.status).toBe(200);

    const ctxB = contextFromVerifiedClaims({ userId: USER_B, traceId: 'trace-b', headers: {} });
    const theirs = await getOwnPortfolio(ctxB, deps);
    expect(theirs.status).toBe(404);
    expect((theirs.body as ApiError).error.code).toBe('not_found');
  });

  // ---------- POST /v1/portfolio/publish (YELLOW) ----------

  it('publish WITHOUT an approval token → capability_denied, nothing published, audited', async () => {
    const dto = await generateOne();

    const res = await publishRoute()(ctxA, {});
    expect(res.status).toBe(403);
    expect((res.body as ApiError).error.code).toBe('capability_denied');

    // Still private — the denial changed nothing.
    const own = await getOwnPortfolio(ctxA, deps);
    expect((own.body as PortfolioDto).status).toBe('private');

    // And still not publicly readable.
    const pub = await getPublicPortfolio(dto.slug, deps);
    expect(pub.status).toBe(404);

    const audit = auditSink.records();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      userId: USER_A,
      action: 'capability_gate.denied',
      target: 'portfolio.publish',
    });
  });

  it('publish WITH a valid token → published once; replay denied', async () => {
    const dto = await generateOne();
    const payload = {};
    const token = await mintApprovalToken({
      userId: USER_A,
      action: 'portfolio.publish',
      payload,
      ttlMs: 60_000,
      secret: SECRET,
      store: tokenStore,
      now: () => NOW.getTime(),
    });
    const ctx = contextFromVerifiedClaims({
      userId: USER_A,
      traceId: 'trace-publish',
      headers: { 'x-approval-token': token },
    });

    const res = await publishRoute()(ctx, payload);
    expect(res.status).toBe(200);
    const published = res.body as PortfolioDto;
    expect(published.status).toBe('published');
    expect(published.publishedAt).toBe(NOW.toISOString());
    expect(published.publishedContent).not.toBeNull();

    // Single-use token: replaying the exact same approved publish is denied.
    const replay = await publishRoute()(ctx, payload);
    expect(replay.status).toBe(403);

    // Now (and only now) the public read serves the frozen snapshot.
    const pub = await getPublicPortfolio(dto.slug, deps);
    expect(pub.status).toBe(200);
    const body = pub.body as PublicPortfolioDto;
    expect(body.slug).toBe(dto.slug);
    expect(body.content).toEqual(published.publishedContent);
  });

  it('publish with a token but no draft → not_found (gate consumed, nothing to freeze)', async () => {
    const token = await mintApprovalToken({
      userId: USER_A,
      action: 'portfolio.publish',
      payload: {},
      ttlMs: 60_000,
      secret: SECRET,
      store: tokenStore,
      now: () => NOW.getTime(),
    });
    const ctx = contextFromVerifiedClaims({
      userId: USER_A,
      traceId: 'trace-empty',
      headers: { 'x-approval-token': token },
    });
    const res = await publishRoute()(ctx, {});
    expect(res.status).toBe(404);
    expect((res.body as ApiError).error.code).toBe('not_found');
  });

  // ---------- public read (published ONLY — private by default) ----------

  it('public read 404s for unpublished portfolios even with the correct slug', async () => {
    const dto = await generateOne();
    const res = await getPublicPortfolio(dto.slug, deps);
    expect(res.status).toBe(404);
    expect((res.body as ApiError).error.code).toBe('not_found');
  });

  it('public read serves the FROZEN snapshot — later draft edits do not leak', async () => {
    const dto = await generateOne();
    const token = await mintApprovalToken({
      userId: USER_A,
      action: 'portfolio.publish',
      payload: {},
      ttlMs: 60_000,
      secret: SECRET,
      store: tokenStore,
      now: () => NOW.getTime(),
    });
    const ctx = contextFromVerifiedClaims({
      userId: USER_A,
      traceId: 'trace-freeze',
      headers: { 'x-approval-token': token },
    });
    const published = await publishRoute()(ctx, {});
    expect(published.status).toBe(200);
    const snapshot = (published.body as PortfolioDto).publishedContent;

    // Regenerate the draft AFTER publishing — the public read must keep
    // serving the frozen snapshot, not the new draft.
    await generateOne();
    const pub = await getPublicPortfolio(dto.slug, deps);
    expect(pub.status).toBe(200);
    expect((pub.body as PublicPortfolioDto).content).toEqual(snapshot);
  });
});