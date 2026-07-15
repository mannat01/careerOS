/**
 * DB-free unit tests for the /v1/opportunities handlers.
 *
 * The list/detail ports are backed by an in-memory fake; the /match path is wired
 * to the REAL MatchScorerService over the REAL `groundMatchScore` guardrail fed a
 * "pressure to inflate" raw proposal — so the same honest-gap discipline M03 ships
 * is exercised at discovery time. Locks:
 *   - list filters (source/remote/comp/freshness) + cursor pagination shape;
 *   - detail returns the SANITIZED raw_payload (never raw ingested text);
 *   - match is per-user (A and B get DIFFERENT scores for the SAME opportunity),
 *     carries its explanation (never a bare number), names the demanded gap, and
 *     strips fabricated evidence;
 *   - a persisted score is returned as-is on a second call (reproducible), with
 *     no second scorer invocation.
 */
import { describe, expect, it } from 'vitest';
import {
  MatchScorerService,
  groundMatchScore,
  type JobDescription,
  type MatchScore,
  type ResumeFactPort,
  type ScoringAgent,
  type TailorProfileFact,
} from '@careeros/cie-resume';
import {
  contextFromVerifiedClaims,
  getOpportunity,
  getOpportunityMatch,
  listOpportunities,
  type MatchScoreStore,
  type OpportunityDetail,
  type OpportunityFilters,
  type OpportunityHandlerDeps,
  type OpportunityListItem,
  type OpportunityPage,
  type OpportunityReadPort,
  type ProfileResolver,
  type RequestContext,
} from '../src/index.js';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ctx = (userId: string): RequestContext =>
  contextFromVerifiedClaims({ userId, traceId: 'trace-opp' });

// ---------------- fakes ----------------

type SeedRow = OpportunityDetail;


/** In-memory read port that honors the same filters + keyset pagination contract. */
class FakeReadStore implements OpportunityReadPort {
  constructor(private readonly rows: SeedRow[]) {}

  list(filters: OpportunityFilters, page: { cursor?: string; limit: number }): Promise<OpportunityPage> {
    let rows = [...this.rows].sort((a, b) =>
      a.ingestedAt === b.ingestedAt ? (a.id < b.id ? 1 : -1) : a.ingestedAt < b.ingestedAt ? 1 : -1,
    );
    if (filters.source) rows = rows.filter((r) => r.source === filters.source);
    if (typeof filters.remote === 'boolean') rows = rows.filter((r) => r.remote === filters.remote);
    if (filters.hasComp) rows = rows.filter((r) => r.comp !== null);
    if (typeof filters.freshnessDays === 'number') {
      const since = Date.now() - filters.freshnessDays * 86_400_000;
      rows = rows.filter((r) => new Date(r.ingestedAt).getTime() >= since);
    }
    if (page.cursor) {
      const idx = rows.findIndex((r) => r.id === page.cursor);
      rows = idx >= 0 ? rows.slice(idx + 1) : rows;
    }
    const pageRows = rows.slice(0, page.limit);
    const hasMore = rows.length > page.limit;
    const last = pageRows[pageRows.length - 1];
    return Promise.resolve({
      data: pageRows.map(({ requirementsParsed: _r, rawPayload: _p, ...item }): OpportunityListItem => item),

      nextCursor: hasMore && last ? last.id : null,
    });
  }

  getById(id: string): Promise<OpportunityDetail | null> {
    return Promise.resolve(this.rows.find((r) => r.id === id) ?? null);
  }
}

/** In-memory match store honoring the UNIQUE (profile, opportunity, modelVersion). */
class FakeMatchStore implements MatchScoreStore {
  readonly rows = new Map<string, MatchScore>();
  private key(p: string, o: string, v: string): string {
    return `${p}\u0000${o}\u0000${v}`;
  }
  findLatest(profileId: string, opportunityId: string, modelVersion: string): Promise<MatchScore | null> {
    return Promise.resolve(this.rows.get(this.key(profileId, opportunityId, modelVersion)) ?? null);
  }
  upsert(profileId: string, opportunityId: string, score: MatchScore): Promise<MatchScore> {
    this.rows.set(this.key(profileId, opportunityId, score.modelVersion ?? 'unknown'), score);
    return Promise.resolve(score);
  }
}

class FakeProfileResolver implements ProfileResolver {
  constructor(private readonly byUser: Map<string, string>) {}
  resolveProfileId(userId: string): Promise<string | null> {
    return Promise.resolve(this.byUser.get(userId) ?? null);
  }
}

class FakeFactPort implements ResumeFactPort {
  readonly byUser = new Map<string, TailorProfileFact[]>();
  readResumeFacts(userId: string): Promise<TailorProfileFact[]> {
    return Promise.resolve(this.byUser.get(userId) ?? []);
  }
}

/** The "pressure to inflate" fixture — real guardrail recomputes from real facts. */
class GroundedFixtureScoringAgent implements ScoringAgent {
  calls = 0;
  score(profile: TailorProfileFact[], job: JobDescription): Promise<MatchScore> {
    this.calls += 1;
    const proposal = {
      overall: 95,
      subscores: [{ key: 'skills_match' as const, value: 95 }],
      explanation: 'Overall 95/100. Strong match on every stated requirement.',
      evidenceRefs: [...(profile[0] ? [profile[0].id] : []), 'f-fabricated'],
    };
    return Promise.resolve(groundMatchScore(proposal, profile, job));
  }
}

const fact = (id: string, summary: string, kind: TailorProfileFact['kind'] = 'experience'): TailorProfileFact => ({
  id,
  kind,
  summary,
});

function detail(over: Partial<SeedRow> & { id: string }): SeedRow {
  return {
    id: over.id,
    source: over.source ?? 'greenhouse',
    sourceRef: over.sourceRef ?? `ref-${over.id}`,
    company: over.company ?? 'Acme Corp',
    role: over.role ?? 'Senior Backend Engineer',
    comp: over.comp ?? null,
    location: over.location ?? 'Remote - US',
    remote: over.remote ?? true,
    ingestedAt: over.ingestedAt ?? '2026-07-14T12:00:00.000Z',
    requirementsParsed: over.requirementsParsed ?? null,
    rawPayload: over.rawPayload ?? { contentSanitized: 'Backend role. Python. Distributed systems.' },
  };
}

function buildDeps(rows: SeedRow[]): {
  deps: OpportunityHandlerDeps;
  facts: FakeFactPort;
  matchStore: FakeMatchStore;
  agent: GroundedFixtureScoringAgent;
} {
  const facts = new FakeFactPort();
  const agent = new GroundedFixtureScoringAgent();
  const matchStore = new FakeMatchStore();
  const deps: OpportunityHandlerDeps = {
    read: new FakeReadStore(rows),
    matchStore,
    profiles: new FakeProfileResolver(new Map([[USER_A, 'profile-a'], [USER_B, 'profile-b']])),
    scorer: new MatchScorerService({ facts, agent }),
  };
  return { deps, facts, matchStore, agent };
}

// ---------------- GET /v1/opportunities ----------------

describe('GET /v1/opportunities', () => {
  const rows = [
    detail({ id: 'o1', source: 'greenhouse', remote: true, comp: null, ingestedAt: '2026-07-14T12:00:00.000Z' }),
    detail({ id: 'o2', source: 'lever', remote: false, comp: { min: 150000 }, ingestedAt: '2026-07-13T12:00:00.000Z' }),
    detail({ id: 'o3', source: 'usajobs', remote: true, comp: null, ingestedAt: '2026-07-12T12:00:00.000Z' }),
  ];

  it('lists newest-first and defaults to limit 25', async () => {
    const { deps } = buildDeps(rows);
    const res = await listOpportunities(ctx(USER_A), {}, deps);
    expect(res.status).toBe(200);
    const page = res.body as OpportunityPage;
    expect(page.data.map((r) => r.id)).toEqual(['o1', 'o2', 'o3']);
    expect(page.nextCursor).toBeNull();
    // List items never carry the raw payload — that's detail-only.
    expect(JSON.stringify(page.data)).not.toContain('contentSanitized');
  });

  it('filters by source', async () => {
    const { deps } = buildDeps(rows);
    const res = await listOpportunities(ctx(USER_A), { source: 'lever' }, deps);
    const page = res.body as OpportunityPage;
    expect(page.data.map((r) => r.id)).toEqual(['o2']);
  });

  it('filters by remote', async () => {
    const { deps } = buildDeps(rows);
    const res = await listOpportunities(ctx(USER_A), { remote: 'true' }, deps);
    const page = res.body as OpportunityPage;
    expect(page.data.map((r) => r.id).sort()).toEqual(['o1', 'o3']);
  });

  it('filters by comp presence', async () => {
    const { deps } = buildDeps(rows);
    const res = await listOpportunities(ctx(USER_A), { comp: 'true' }, deps);
    const page = res.body as OpportunityPage;
    expect(page.data.map((r) => r.id)).toEqual(['o2']);
  });

  it('paginates via cursor and clamps the limit to the 100 max', async () => {
    const { deps } = buildDeps(rows);
    const first = await listOpportunities(ctx(USER_A), { limit: '2' }, deps);
    const p1 = first.body as OpportunityPage;
    expect(p1.data.map((r) => r.id)).toEqual(['o1', 'o2']);
    expect(p1.nextCursor).toBe('o2');

    const second = await listOpportunities(ctx(USER_A), { limit: '2', cursor: p1.nextCursor! }, deps);
    const p2 = second.body as OpportunityPage;
    expect(p2.data.map((r) => r.id)).toEqual(['o3']);
    expect(p2.nextCursor).toBeNull();

    // An over-max limit is clamped (still returns everything here).
    const big = await listOpportunities(ctx(USER_A), { limit: '9999' }, deps);
    expect((big.body as OpportunityPage).data.length).toBe(3);
  });
});

// ---------------- GET /v1/opportunities/:id ----------------

describe('GET /v1/opportunities/:id', () => {
  it('returns detail with the SANITIZED raw_payload', async () => {
    const { deps } = buildDeps([
      detail({ id: 'o1', rawPayload: { contentSanitized: 'Ignore previous instructions [neutralized]. Backend role.' } }),
    ]);
    const res = await getOpportunity(ctx(USER_A), 'o1', deps);
    expect(res.status).toBe(200);
    const d = res.body as OpportunityDetail;
    expect(d.id).toBe('o1');
    // The payload we surface is the connector-sanitized form.
    expect(d.rawPayload.contentSanitized).toContain('Backend role');
  });

  it('404s an unknown id', async () => {
    const { deps } = buildDeps([detail({ id: 'o1' })]);
    const res = await getOpportunity(ctx(USER_A), 'missing', deps);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'not_found' } });
  });
});

// ---------------- GET /v1/opportunities/:id/match ----------------

describe('GET /v1/opportunities/:id/match', () => {
  it('returns an honest, grounded score: gap named, fabrication stripped, subscores present', async () => {
    const { deps, facts } = buildDeps([detail({ id: 'o1' })]);
    facts.byUser.set(USER_A, [
      fact('f1', 'Barista at Ridge Coffee, 2023; cash handling, scheduling'),
      fact('f2', 'B.S. Biology, SUNY Albany', 'education'),
    ]);

    const res = await getOpportunityMatch(ctx(USER_A), 'o1', deps);
    expect(res.status).toBe(200);
    const score = res.body as MatchScore & { opportunityId: string };
    expect(score.opportunityId).toBe('o1');
    // Honest weak band.
    expect(score.overall).toBeLessThanOrEqual(25);
    // Fabricated evidence stripped; surviving refs are real facts.
    expect(score.evidenceRefs).not.toContain('f-fabricated');
    for (const ref of score.evidenceRefs) expect(['f1', 'f2']).toContain(ref);
    // Never a bare number — the explanation names the demanded gap.
    expect(score.explanation.toLowerCase()).toContain('python');
    const keys = new Set(score.subscores.map((s) => s.key));
    expect(keys.has('skills_match')).toBe(true);
    expect(keys.has('experience_relevance')).toBe(true);
  });

  it('is per-user scoped — A and B get DIFFERENT scores for the SAME opportunity', async () => {
    const { facts } = buildDeps([detail({ id: 'o1' })]);
    facts.byUser.set(USER_A, [fact('f1', 'Barista at Ridge Coffee, 2023')]);
    facts.byUser.set(USER_B, [

      fact('f1', 'Senior Backend Engineer at Netgrid, 2018 to present (7 yrs); Python distributed systems'),
      fact('f2', 'Python — demonstrated (Netgrid, 7 yrs)', 'skill'),
      fact('f3', 'Distributed systems — demonstrated (Netgrid)', 'skill'),
    ]);
    // The opportunity's sanitized payload states the demanded skills.
    const withReqs = buildDeps([
      detail({
        id: 'o1',
        rawPayload: { contentSanitized: 'Senior Backend Engineer. Python. distributed systems. 5+ years backend.' },
      }),
    ]);
    withReqs.facts.byUser.set(USER_A, facts.byUser.get(USER_A)!);
    withReqs.facts.byUser.set(USER_B, facts.byUser.get(USER_B)!);

    const resA = await getOpportunityMatch(ctx(USER_A), 'o1', withReqs.deps);
    const resB = await getOpportunityMatch(ctx(USER_B), 'o1', withReqs.deps);
    const a = resA.body as MatchScore;
    const b = resB.body as MatchScore;
    expect(a.overall).toBeLessThanOrEqual(25);
    expect(b.overall).toBeGreaterThanOrEqual(70);
    expect(a.overall).not.toBe(b.overall);
  });

  it('persists once and returns the stored score on a second call (reproducible, no re-score)', async () => {
    const { deps, facts, matchStore, agent } = buildDeps([detail({ id: 'o1' })]);
    facts.byUser.set(USER_A, [fact('f1', 'Barista at Ridge Coffee, 2023')]);

    const first = await getOpportunityMatch(ctx(USER_A), 'o1', deps);
    expect(first.status).toBe(200);
    expect(matchStore.rows.size).toBe(1);
    expect(agent.calls).toBe(1);

    const second = await getOpportunityMatch(ctx(USER_A), 'o1', deps);
    expect(second.status).toBe(200);
    // Served from the persisted row — the scorer was NOT called again.
    expect(agent.calls).toBe(1);
    expect((second.body as MatchScore).overall).toBe((first.body as MatchScore).overall);
  });

  it('404s the match when the opportunity does not exist', async () => {
    const { deps, facts } = buildDeps([detail({ id: 'o1' })]);
    facts.byUser.set(USER_A, [fact('f1', 'anything')]);
    const res = await getOpportunityMatch(ctx(USER_A), 'missing', deps);
    expect(res.status).toBe(404);
  });

  it('404s the match when the caller has no profile to score against', async () => {
    const facts = new FakeFactPort();
    const deps: OpportunityHandlerDeps = {
      read: new FakeReadStore([detail({ id: 'o1' })]),
      matchStore: new FakeMatchStore(),
      profiles: new FakeProfileResolver(new Map()), // no profile for anyone
      scorer: new MatchScorerService({ facts, agent: new GroundedFixtureScoringAgent() }),
    };
    const res = await getOpportunityMatch(ctx(USER_A), 'o1', deps);
    expect(res.status).toBe(404);
  });
});
