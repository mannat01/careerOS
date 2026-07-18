/**
 * M07 Step 3 — GET /v1/cie/research{,/feed} + /v1/cie/recommendations
 * handler unit tests. DB-free — exercise the pure handlers against fake ports.
 *
 * Locks the invariants the e2e can't cheaply prove per-branch:
 *  - per-user scoping (userId flows ONLY from RequestContext, never from body/query),
 *  - domain validation (unknown domain → 400 validation_failed),
 *  - allow-list defense-in-depth: a persisted finding whose sourceKey is NOT on
 *    the allow-list is FILTERED before it can leave the handler (citations
 *    restricted to sanctioned sources end-to-end),
 *  - personalization: feed uses the per-user "affecting" filter, so two users
 *    see different feeds from the SAME finding pool,
 *  - synthesizer sees only sanctioned allow-listed sources.
 */
import { describe, expect, it } from 'vitest';
import {
  contextFromVerifiedClaims,
  listResearchFindings,
  researchFeed,
  researchRecommendations,
  type PersistedResearchFinding,
  type RequestContext,
  type ResearchFindingReadPort,
  type ResearchSynthesizerPort,
} from '../src/index.js';
import {
  InMemoryResearchSourceRegistry,
  M07_RESEARCH_SOURCE_SEED,
} from '@careeros/connectors';
import type { ResearchSynthesis, StrengthConfidenceCap } from '@careeros/cie-research';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ctx = (userId: string): RequestContext =>
  contextFromVerifiedClaims({ userId, traceId: 'trace-r7' });

// -------- fakes --------

function mkFinding(over: Partial<PersistedResearchFinding> = {}): PersistedResearchFinding {
  return {
    id: 'f-1',
    sourceKey: 'bls-employment',
    sourceRef: 'CES0000000001:2026-06',
    domain: 'hiring',
    summary: 'US total nonfarm payrolls grew 187k in June 2026.',
    url: 'https://api.bls.gov/publicAPI/v2/timeseries/data/CES0000000001',
    strength: 'strong',
    observedAt: '2026-07-01T00:00:00.000Z',
    entities: { skills: [], companies: [], industries: ['tech'] },
    ...over,
  };
}

class FakeReadPort implements ResearchFindingReadPort {
  constructor(
    private readonly all: PersistedResearchFinding[],
    private readonly userAffecting: Map<string, PersistedResearchFinding[]>,
  ) {}
  listFindings(query: {
    domain?: PersistedResearchFinding['domain'];
    limit: number;
  }): Promise<PersistedResearchFinding[]> {
    const rows = query.domain ? this.all.filter((f) => f.domain === query.domain) : this.all;
    return Promise.resolve(rows.slice(0, query.limit));
  }
  listFindingsAffectingUser(query: { userId: string; limit: number }): Promise<PersistedResearchFinding[]> {
    return Promise.resolve((this.userAffecting.get(query.userId) ?? []).slice(0, query.limit));
  }
}

class FakeSynthesizer implements ResearchSynthesizerPort {
  public receivedUserId: string | null = null;
  public receivedCap: StrengthConfidenceCap | undefined;
  constructor(private readonly synth: ResearchSynthesis) {}
  synthesize(userId: string, cap?: StrengthConfidenceCap): Promise<ResearchSynthesis> {
    this.receivedUserId = userId;
    this.receivedCap = cap;
    return Promise.resolve(this.synth);
  }
}

const registry = new InMemoryResearchSourceRegistry(M07_RESEARCH_SOURCE_SEED);

// -------- 1. list --------

describe('listResearchFindings', () => {
  it('returns findings + the sanctioned allow-list', async () => {
    const port = new FakeReadPort([mkFinding()], new Map());
    const res = await listResearchFindings(
      ctx(USER_A),
      { limit: '10' },
      { findings: port, registry, synthesizer: new FakeSynthesizer({ recommendations: [], evidence: [], generatedAt: '' } as unknown as ResearchSynthesis) },
    );
    expect(res.status).toBe(200);
    const body = (res as { body: { count: number; allowedSources: string[]; domain: unknown } }).body;
    expect(body.count).toBe(1);
    expect(body.domain).toBeNull();
    expect(body.allowedSources).toEqual(registry.allowedSourceKeys());
  });

  it('filters by domain when a valid one is passed', async () => {
    const port = new FakeReadPort(
      [mkFinding({ id: 'a', domain: 'hiring' }), mkFinding({ id: 'b', domain: 'salary' })],
      new Map(),
    );
    const res = await listResearchFindings(
      ctx(USER_A),
      { domain: 'salary', limit: '10' },
      { findings: port, registry, synthesizer: new FakeSynthesizer({ recommendations: [], evidence: [], generatedAt: '' } as unknown as ResearchSynthesis) },
    );
    const body = (res as { body: { count: number; findings: PersistedResearchFinding[] } }).body;
    expect(body.count).toBe(1);
    expect(body.findings[0]!.id).toBe('b');
  });

  it('rejects an unknown domain with 400 validation_failed', async () => {
    const port = new FakeReadPort([], new Map());
    const res = await listResearchFindings(
      ctx(USER_A),
      { domain: 'not-a-real-domain' },
      { findings: port, registry, synthesizer: new FakeSynthesizer({ recommendations: [], evidence: [], generatedAt: '' } as unknown as ResearchSynthesis) },
    );
    expect(res.status).toBe(422);
    expect((res as { body: { error: { code: string } } }).body.error.code).toBe('validation_failed');
  });

  it('drops findings whose sourceKey is NOT on the sanctioned allow-list (defense-in-depth)', async () => {
    const port = new FakeReadPort(
      [
        mkFinding({ id: 'good', sourceKey: 'bls-employment' }),
        mkFinding({ id: 'evil', sourceKey: 'attacker-feed' }),
      ],
      new Map(),
    );
    const res = await listResearchFindings(
      ctx(USER_A),
      {},
      { findings: port, registry, synthesizer: new FakeSynthesizer({ recommendations: [], evidence: [], generatedAt: '' } as unknown as ResearchSynthesis) },
    );
    const body = (res as { body: { count: number; findings: PersistedResearchFinding[] } }).body;
    expect(body.count).toBe(1);
    expect(body.findings[0]!.id).toBe('good');
    // The non-allow-listed one MUST NOT surface to a citation-capable endpoint.
    expect(body.findings.some((f) => f.sourceKey === 'attacker-feed')).toBe(false);
  });
});

// -------- 2. feed (personalization) --------

describe('researchFeed', () => {
  it('scopes to the caller and returns different feeds per-user from the same pool', async () => {
    const forA = [mkFinding({ id: 'a1' }), mkFinding({ id: 'a2', sourceKey: 'onet-skills', domain: 'skills' })];
    const forB = [mkFinding({ id: 'b1', sourceKey: 'sec-edgar', domain: 'company' })];
    const port = new FakeReadPort([], new Map([[USER_A, forA], [USER_B, forB]]));
    const deps = { findings: port, registry, synthesizer: new FakeSynthesizer({ recommendations: [], evidence: [], generatedAt: '' } as unknown as ResearchSynthesis) };

    const resA = await researchFeed(ctx(USER_A), {}, deps);
    const resB = await researchFeed(ctx(USER_B), {}, deps);

    const bodyA = (resA as { body: { personalizedFor: string; findings: PersistedResearchFinding[] } }).body;
    const bodyB = (resB as { body: { personalizedFor: string; findings: PersistedResearchFinding[] } }).body;
    expect(bodyA.personalizedFor).toBe(USER_A);
    expect(bodyB.personalizedFor).toBe(USER_B);
    expect(bodyA.findings.map((f) => f.id).sort()).toEqual(['a1', 'a2']);
    expect(bodyB.findings.map((f) => f.id)).toEqual(['b1']);
  });

  it('applies the sanctioned allow-list filter to the personalized feed too', async () => {
    const forA = [mkFinding({ id: 'ok' }), mkFinding({ id: 'poison', sourceKey: 'attacker-feed' })];
    const port = new FakeReadPort([], new Map([[USER_A, forA]]));
    const res = await researchFeed(
      ctx(USER_A),
      {},
      { findings: port, registry, synthesizer: new FakeSynthesizer({ recommendations: [], evidence: [], generatedAt: '' } as unknown as ResearchSynthesis) },
    );
    const body = (res as { body: { findings: PersistedResearchFinding[] } }).body;
    expect(body.findings.map((f) => f.id)).toEqual(['ok']);
  });
});

// -------- 3. recommendations --------

describe('researchRecommendations', () => {
  it('passes the caller user + cap to the synthesizer and returns the sanctioned allow-list', async () => {
    const synth: ResearchSynthesis = {
      recommendations: [],
      evidence: [],
      generatedAt: '2026-07-01T00:00:00.000Z',
    } as unknown as ResearchSynthesis;
    const synthesizer = new FakeSynthesizer(synth);
    const port = new FakeReadPort([], new Map());
    const res = await researchRecommendations(
      ctx(USER_A),
      { cap: JSON.stringify({ weak: 0.3, medium: 0.6, strong: 0.85 }) },
      { findings: port, registry, synthesizer },
    );
    expect(res.status).toBe(200);
    expect(synthesizer.receivedUserId).toBe(USER_A);
    expect(synthesizer.receivedCap).toEqual({ weak: 0.3, medium: 0.6, strong: 0.85 });
    const body = (res as { body: { allowedSources: string[]; personalizedFor: string } }).body;
    expect(body.personalizedFor).toBe(USER_A);
    expect(body.allowedSources).toEqual(registry.allowedSourceKeys());
  });

  it('ignores out-of-range cap values (defaults inside the synthesizer apply)', async () => {
    const synthesizer = new FakeSynthesizer({
      recommendations: [],
      evidence: [],
      generatedAt: '2026-07-01T00:00:00.000Z',
    } as unknown as ResearchSynthesis);
    const port = new FakeReadPort([], new Map());
    await researchRecommendations(
      ctx(USER_A),
      { cap: JSON.stringify({ weak: -1, medium: 5, strong: 'nope' }) },
      { findings: port, registry, synthesizer },
    );
    expect(synthesizer.receivedCap).toBeUndefined();
  });
});