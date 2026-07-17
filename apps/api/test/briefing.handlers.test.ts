/**
 * DB-free unit tests for M05 Stage-5 Step-5 manual Briefing orchestration.
 *
 * The store is an in-memory fake honoring the same per-user + steps/cost
 * append + audit contract the Prisma store implements. Real ports for the
 * scored-opportunity + gap + focus steps are wired to in-memory fakes that
 * mirror the shapes of the concrete services, so the orchestrator's
 * step-by-step composition + failure-handling is exercised end-to-end
 * without a database.
 *
 * Locks:
 *   - a successful run composes at least ONE opportunity + gap + focus item;
 *     steps/cost/traceId are recorded on the run; audit is appended;
 *   - a failing step yields a PARTIAL run (not blank/failed) with that step
 *     flagged + retryable + an error message — never a thrown request;
 *   - every step failing yields a `failed` status but the run + step trace
 *     still persist;
 *   - per-user scoping: user A cannot getById user B's run;
 *   - `latest` returns the newest run for the user;
 *   - items are `proposed` — nothing acts.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { AuditClient, AuditRecord } from '@careeros/observability';
import type { MatchScore, JobDescription } from '@careeros/cie-resume';
import type { CareerStateModel } from '@careeros/cie-state';
import type { DecisionContract, ReasonerOpportunity } from '@careeros/cie-reasoning';
import {
  contextFromVerifiedClaims,
  getBriefing,
  getLatestBriefing,
  runManualBriefing,
  type BriefingHandlerDeps,
  type BriefingItem,
  type BriefingRun,
  type BriefingRunDetail,
  type BriefingRunStatus,
  type BriefingStepRecord,
  type BriefingStorePort,
  type OpportunityDetail,
  type OpportunityFilters,
  type OpportunityListItem,
  type OpportunityPage,
  type OpportunityReadPort,
  type ProfileResolver,
  type RequestContext,
} from '../src/index.js';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ctxUser = (userId: string): RequestContext =>
  contextFromVerifiedClaims({ userId, traceId: 'trace-brief' });

// ---------------- fake store ----------------

class FakeStore implements BriefingStorePort {
  runs = new Map<string, BriefingRun>();
  items = new Map<string, BriefingItem[]>();
  private seq = 0;

  createRun(input: {
    userId: string;
    trigger: 'scheduled' | 'manual';
    inputs: Record<string, unknown>;
  }): Promise<BriefingRun> {
    const id = `run-${++this.seq}`;
    const now = new Date().toISOString();
    const run: BriefingRun = {
      id,
      userId: input.userId,
      trigger: input.trigger,
      status: 'running',
      inputs: input.inputs,
      steps: [],
      costTotal: 0,
      startedAt: now,
      finishedAt: null,
    };
    this.runs.set(id, run);
    this.items.set(id, []);
    return Promise.resolve(run);
  }

  finalizeRun(
    runId: string,
    input: {
      status: BriefingRunStatus;
      steps: BriefingStepRecord[];
      costTotal: number;
      finishedAt: string;
    },
  ): Promise<BriefingRun> {
    const cur = this.runs.get(runId)!;
    const next: BriefingRun = { ...cur, ...input };
    this.runs.set(runId, next);
    return Promise.resolve(next);
  }

  addItems(
    runId: string,
    items: Omit<BriefingItem, 'id' | 'createdAt'>[],
  ): Promise<BriefingItem[]> {
    const cur = this.items.get(runId) ?? [];
    const now = new Date().toISOString();
    const withIds = items.map((i, idx): BriefingItem => ({
      ...i,
      id: `${runId}-item-${cur.length + idx + 1}`,
      createdAt: now,
    }));
    this.items.set(runId, [...cur, ...withIds]);
    return Promise.resolve(withIds);
  }

  getById(userId: string, id: string): Promise<BriefingRunDetail | null> {
    const run = this.runs.get(id);
    if (!run || run.userId !== userId) return Promise.resolve(null);
    return Promise.resolve({ ...run, items: this.items.get(id) ?? [] });
  }

  latestForUser(userId: string): Promise<BriefingRunDetail | null> {
    const owned = [...this.runs.values()].filter((r) => r.userId === userId);
    if (owned.length === 0) return Promise.resolve(null);
    owned.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    const latest = owned[0]!;
    return Promise.resolve({ ...latest, items: this.items.get(latest.id) ?? [] });
  }
}

// ---------------- fake opportunity read port ----------------

const OPP_1: OpportunityDetail = {
  id: 'opp-1',
  source: 'greenhouse',
  sourceRef: 'gh-1',
  company: 'Acme',
  role: 'Senior Software Engineer',
  location: 'Remote',
  remote: true,
  comp: { min: 180000, max: 220000, currency: 'USD' },
  requirementsParsed: null,
  rawPayload: { sanitized: 'ok' },
  ingestedAt: new Date().toISOString(),
};
const OPP_2: OpportunityDetail = {
  id: 'opp-2',
  source: 'greenhouse',
  sourceRef: 'gh-2',
  company: 'Globex',
  role: 'Staff Engineer',
  location: 'NYC',
  remote: false,
  comp: null,
  requirementsParsed: null,
  rawPayload: { sanitized: 'ok' },
  ingestedAt: new Date().toISOString(),
};

class FakeReadStore implements OpportunityReadPort {
  constructor(private readonly rows: OpportunityDetail[]) {}
  list(_f: OpportunityFilters, page: { cursor?: string; limit: number }): Promise<OpportunityPage> {
    const rows = this.rows.slice(0, page.limit);
    return Promise.resolve({
      data: rows.map(({ rawPayload: _p, requirementsParsed: _r, ...i }): OpportunityListItem => i),
      nextCursor: null,
    });
  }
  getById(id: string): Promise<OpportunityDetail | null> {
    return Promise.resolve(this.rows.find((r) => r.id === id) ?? null);
  }
}

const profiles: ProfileResolver = {
  resolveProfileId: (userId: string) => Promise.resolve(`profile-of-${userId}`),
};

// ---------------- fake scorer / reasoner / state ----------------

const makeScore = (overall: number, weakDim = 'python'): MatchScore => ({
  overall,
  subscores: [
    { key: 'skills', value: 40 }, // weak → triggers a per-opportunity gap
    { key: 'seniority', value: 80 },
  ],
  explanation: `Grounded explanation: strong on TS, gap on ${weakDim}.`,
  evidenceRefs: ['fact-1', 'fact-2'],
  modelVersion: 'match-scorer@1.0.0',
});

// Structural stub — the handler only calls .scoreJob().
const scorer = {
  scoreJob: (_userId: string, _job: JobDescription): Promise<MatchScore> =>
    Promise.resolve(makeScore(78)),
} as unknown as BriefingHandlerDeps['scorer'];

// Structural stub — the handler only calls .decide().
const contract: DecisionContract = {
  recommendation: 'apply',
  alternatives: ['wait', 'negotiate'],
  evidenceRefs: ['fact-1'],
  reasoning: 'Grounded reasoning summary.',
  confidence: 0.72,
  assumptions: ['assumes availability'],
  modelVersion: 'strategic-reasoner@1.0.0',
};
const reasoner = {
  decide: (
    _u: string,
    _q: string,
    _o: ReasonerOpportunity | undefined,
  ): Promise<DecisionContract> => Promise.resolve(contract),
} as unknown as BriefingHandlerDeps['reasoner'];

// Career State Model — one LOW-confidence dimension → aggregate gap.
const stateModel: CareerStateModel = {
  profileId: 'profile-x',
  version: 1,
  updatedAt: new Date().toISOString(),
  dimensions: [
    {
      dimension: 'compensation_goals',
      value: { values: [] },
      confidence: 0.2,
      provenance: 'inferred',
      evidenceRefs: [],
      freshnessAt: new Date().toISOString(),
      modelVersion: 'state-updater@1.0.0',
    },
    {
      dimension: 'demonstrated_skills',
      value: { values: ['typescript'] },
      confidence: 0.9,
      provenance: 'demonstrated',
      evidenceRefs: ['exp-1'],
      freshnessAt: new Date().toISOString(),
      modelVersion: 'state-updater@1.0.0',
    },
  ],
};
const state = {
  getState: (_u: string) => Promise.resolve(stateModel),
} as unknown as BriefingHandlerDeps['state'];

// ---------------- fake audit ----------------

class FakeAudit implements AuditClient {
  records: AuditRecord[] = [];
  append(input: Parameters<AuditClient['append']>[0]): Promise<AuditRecord> {
    const rec: AuditRecord = Object.freeze({
      id: `audit-${this.records.length + 1}`,
      userId: input.userId,
      actor: input.actor,
      action: input.action,
      target: input.target ?? null,
      reason: input.reason,
      modelVersion: input.modelVersion ?? null,
      traceId: input.traceId ?? null,
      at: new Date().toISOString(),
    });
    this.records.push(rec);
    return Promise.resolve(rec);
  }
}

// ---------------- test setup ----------------

let deps: BriefingHandlerDeps;
let store: FakeStore;
let audit: FakeAudit;

beforeEach(() => {
  store = new FakeStore();
  audit = new FakeAudit();
  deps = {
    store,
    opportunities: new FakeReadStore([OPP_1, OPP_2]),
    profiles,
    scorer,
    reasoner,
    state,
    audit,
    topN: 2,
  };
});

// ---------------- tests ----------------

describe('POST /v1/briefings/run — manual composition', () => {
  it('composes at least opportunity + gap + focus items and records steps/cost/audit', async () => {
    const res = await runManualBriefing(ctxUser(USER_A), { trigger: 'manual' }, deps);
    expect(res.status).toBe(201);
    const body = res.body as BriefingRunDetail;
    expect(body.status).toBe('complete');
    expect(body.steps.map((s) => s.name)).toEqual(['scored_opportunities', 'gaps', 'focus']);
    for (const s of body.steps) {
      expect(s.status).toBe('ok');
      expect(s.traceId).toMatch(/[0-9a-f-]{36}/);
    }
    expect(body.costTotal).toBeGreaterThan(0);
    expect(body.finishedAt).not.toBeNull();

    const kinds = body.items.map((i) => i.kind);
    expect(kinds).toContain('opportunity');
    expect(kinds).toContain('gap');
    expect(kinds).toContain('focus');
    // Advisory Green + proposed — nothing acts.
    for (const i of body.items) {
      expect(i.state).toBe('proposed');
      expect(i.autonomyTier).toBe('green');
    }
    // Audit row written for the run.
    expect(audit.records.length).toBe(1);
    expect(audit.records[0]!.action).toBe('briefing.run.manual');
    expect(audit.records[0]!.target).toBe(body.id);
  });

  it('composes an aggregate gap from a LOW-confidence state dimension', async () => {
    const res = await runManualBriefing(ctxUser(USER_A), { trigger: 'manual' }, deps);
    const body = res.body as BriefingRunDetail;
    const aggregate = body.items.find(
      (i) => i.kind === 'gap' && (i.payload as { scope?: string }).scope === 'aggregate',
    );
    expect(aggregate).toBeDefined();
    expect((aggregate!.payload as { dimension: string }).dimension).toBe('compensation_goals');
  });

  it('a failing step yields a PARTIAL run (never blank) with that step flagged + retryable', async () => {
    deps.overrides = {
      gaps: () => Promise.reject(new Error('injected gap-step failure')),
    };
    const res = await runManualBriefing(ctxUser(USER_A), { trigger: 'manual' }, deps);
    expect(res.status).toBe(201);
    const body = res.body as BriefingRunDetail;
    expect(body.status).toBe('partial');
    const gapStep = body.steps.find((s) => s.name === 'gaps')!;
    expect(gapStep.status).toBe('failed');
    expect(gapStep.error).toContain('injected gap-step failure');
    expect(gapStep.retryable).toBe(true);
    // Other steps still succeeded + still composed items → NOT blank.
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((i) => i.kind === 'opportunity')).toBe(true);
    expect(body.items.some((i) => i.kind === 'focus')).toBe(true);
  });

  it('every step failing yields FAILED status but the run + step trace still persist', async () => {
    deps.overrides = {
      scoredOpportunities: () => Promise.reject(new Error('src down')),
      gaps: () => Promise.reject(new Error('gap down')),
      focus: () => Promise.reject(new Error('reasoner down')),
    };
    const res = await runManualBriefing(ctxUser(USER_A), { trigger: 'manual' }, deps);
    const body = res.body as BriefingRunDetail;
    expect(body.status).toBe('failed');
    expect(body.steps.length).toBe(3);
    expect(body.steps.every((s) => s.status === 'failed')).toBe(true);
    expect(body.items.length).toBe(0);
    // Record persisted regardless.
    const persisted = await store.getById(USER_A, body.id);
    expect(persisted).not.toBeNull();
  });

  it('rejects a body missing trigger:"manual"', async () => {
    const res = await runManualBriefing(ctxUser(USER_A), { trigger: 'scheduled' }, deps);
    expect(res.status).toBe(422);
  });
});

describe('GET /v1/briefings/:id + /latest', () => {
  it('returns a run to its owner and 404s a cross-user id', async () => {
    const created = await runManualBriefing(ctxUser(USER_A), { trigger: 'manual' }, deps);
    const id = (created.body as BriefingRunDetail).id;

    const own = await getBriefing(ctxUser(USER_A), id, deps);
    expect(own.status).toBe(200);

    const cross = await getBriefing(ctxUser(USER_B), id, deps);
    expect(cross.status).toBe(404);
  });

  it('latest returns the newest run for the caller', async () => {
    await runManualBriefing(ctxUser(USER_A), { trigger: 'manual' }, deps);
    // Small wait so startedAt differs deterministically.
    await new Promise((r) => setTimeout(r, 5));
    const second = await runManualBriefing(ctxUser(USER_A), { trigger: 'manual' }, deps);
    const latest = await getLatestBriefing(ctxUser(USER_A), deps);
    expect(latest.status).toBe(200);
    expect((latest.body as BriefingRunDetail).id).toBe((second.body as BriefingRunDetail).id);
  });

  it('latest is 404 when the user has no runs yet', async () => {
    const latest = await getLatestBriefing(ctxUser(USER_B), deps);
    expect(latest.status).toBe(404);
  });
});