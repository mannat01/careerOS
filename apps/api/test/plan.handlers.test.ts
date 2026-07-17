/**
 * DB-free unit tests for M06 Stage-6 Step-3 Strategy Plan handlers.
 *
 * The store is an in-memory fake honoring the same PER-USER + supersession
 * contract the PrismaStrategyPlanStore implements. The planner service is a
 * stub returning a deterministic StrategyPlanSet. These tests cover the four
 * lock invariants of the milestone:
 *
 *   - generate → persist (writeActivePlans is called with per-horizon input;
 *     the response echoes the stored records + today's move);
 *   - MATERIAL change regenerates + supersedes prior + stores an explained
 *     diff on the new active row + emits ONE MemoryEvent;
 *   - SUB-THRESHOLD change is a NO-OP: no write, no memory event, no thrash;
 *   - action status update persists via the store's updateAction port;
 *   - per-user scoping: user B cannot read user A's plan (store scopes by
 *     userId — a cross-user get returns null).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { AuditClient, AuditRecord, AuditRecordInput } from '@careeros/observability';
import type {
  PlanChangeEvent,
  ReplanResult,
  ResearchSignal,
  StrategyPlanSet,
} from '@careeros/cie-planner';
import { STRATEGIC_PLANNER_MODEL_VERSION } from '@careeros/cie-planner';
import {
  contextFromVerifiedClaims,
  createPlans,
  getPlanByHorizon,
  getPlans,
  patchPlanAction,
  regeneratePlan,
  type PlanHandlerDeps,
  type PlanMemoryPort,
  type RequestContext,
} from '../src/index.js';

// mirror the tiny cross-package shapes to avoid an @careeros/db import here
type PlanHorizonLike = '30d' | '90d' | '1y' | '3y' | '5y';
type PlanActionKindLike = 'skill' | 'project' | 'cert' | 'role' | 'network' | 'other';
type PlanActionStatusLike = 'suggested' | 'in_progress' | 'done' | 'dropped';
type PlanStatusLike = 'active' | 'superseded';

interface PersistPlanActionLike {
  actionKey: string;
  kind: PlanActionKindLike;
  title: string;
  rationale: string;
  orderIndex: number;
  evidenceRefs: string[];
}
interface PersistPlanLike {
  horizon: PlanHorizonLike;
  summary: string;
  goalRefs: string[];
  diffSummary?: string | null;
  rationale?: string | null;
  modelVersion: string;
  actions: PersistPlanActionLike[];
}
interface PlanActionRecordLike {
  id: string;
  actionKey: string;
  kind: PlanActionKindLike;
  title: string;
  rationale: string;
  orderIndex: number;
  status: PlanActionStatusLike;
  progress: number;
  evidenceRefs: string[];
}
interface StrategyPlanRecordLike {
  id: string;
  horizon: PlanHorizonLike;
  status: PlanStatusLike;
  summary: string;
  goalRefs: string[];
  diffSummary: string | null;
  rationale: string | null;
  modelVersion: string;
  supersededById: string | null;
  createdAt: string;
  updatedAt: string;
  actions: PlanActionRecordLike[];
}

// --------- fakes ----------

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ctxUser = (userId: string): RequestContext =>
  contextFromVerifiedClaims({ userId, traceId: 'trace-plan' });

const HORIZON_ORDER: PlanHorizonLike[] = ['30d', '90d', '1y', '3y', '5y'];

class FakeStore {
  private seq = 0;
  private rows: StrategyPlanRecordLike[] = [];
  private rowsByUser = new Map<string, StrategyPlanRecordLike[]>();

  writeActivePlans(userId: string, plans: PersistPlanLike[]): Promise<StrategyPlanRecordLike[]> {
    const forUser = this.rowsByUser.get(userId) ?? [];
    const out: StrategyPlanRecordLike[] = [];
    for (const p of plans) {
      // supersede prior active for this horizon first
      const prior = forUser.find((r) => r.horizon === p.horizon && r.status === 'active');
      const newId = `plan-${++this.seq}`;
      const now = new Date(this.seq * 1000).toISOString();
      const newRow: StrategyPlanRecordLike = {
        id: newId,
        horizon: p.horizon,
        status: 'active',
        summary: p.summary,
        goalRefs: p.goalRefs,
        diffSummary: p.diffSummary ?? null,
        rationale: p.rationale ?? null,
        modelVersion: p.modelVersion,
        supersededById: null,
        createdAt: now,
        updatedAt: now,
        actions: p.actions.map((a, idx) => ({
          id: `${newId}-a${idx}`,
          actionKey: a.actionKey,
          kind: a.kind,
          title: a.title,
          rationale: a.rationale,
          orderIndex: a.orderIndex,
          status: 'suggested',
          progress: 0,
          evidenceRefs: a.evidenceRefs,
        })),
      };
      if (prior) {
        prior.status = 'superseded';
        prior.supersededById = newId;
      }
      forUser.push(newRow);
      out.push(newRow);
    }
    this.rowsByUser.set(userId, forUser);
    return Promise.resolve(out);
  }

  getActivePlans(userId: string): Promise<StrategyPlanRecordLike[]> {
    const forUser = this.rowsByUser.get(userId) ?? [];
    return Promise.resolve(
      forUser
        .filter((r) => r.status === 'active')
        .sort((a, b) => HORIZON_ORDER.indexOf(a.horizon) - HORIZON_ORDER.indexOf(b.horizon)),
    );
  }

  getActivePlanByHorizon(
    userId: string,
    horizon: PlanHorizonLike,
  ): Promise<StrategyPlanRecordLike | null> {
    const forUser = this.rowsByUser.get(userId) ?? [];
    return Promise.resolve(forUser.find((r) => r.horizon === horizon && r.status === 'active') ?? null);
  }

  updateAction(
    userId: string,
    actionId: string,
    patch: { status?: PlanActionStatusLike; progress?: number },
  ): Promise<PlanActionRecordLike | null> {
    const forUser = this.rowsByUser.get(userId) ?? [];
    for (const plan of forUser) {
      const a = plan.actions.find((x) => x.id === actionId);
      if (a) {
        if (patch.status !== undefined) a.status = patch.status;
        if (patch.progress !== undefined) a.progress = patch.progress;
        return Promise.resolve({ ...a });
      }
    }
    return Promise.resolve(null);
  }
}

// deterministic planner: single-action per horizon
function fakePlanSet(userId: string, marker = 'v1'): StrategyPlanSet {
  return {
    plans: HORIZON_ORDER.map((h) => ({
      horizon: h,
      objective: `Objective for ${h} (${marker}) [${userId}]`,
      actions: [
        {
          id: `${h}-${marker}-a1`,
          title: `Top action ${h} ${marker}`,
          goalId: 'goal:career_goals:0',
          targetNodeId: 'node:skill:1',
          gapId: undefined,
          metric: 'weekly-hours',
          rationale: `Because ${marker}`,
          expectedImpact: 'Meaningful',
          confidence: 0.7,
          kind: h === '3y' || h === '5y' ? 'directional' : 'concrete',
        },
      ],
    })),
    todaysMove: { actionId: `30d-${marker}-a1`, justification: `Top action of 30d ${marker}` },
    modelVersion: STRATEGIC_PLANNER_MODEL_VERSION,
  };
}

class FakePlannerService {
  planCalls = 0;
  replanCalls = 0;
  plan(userId: string, _research?: ResearchSignal): Promise<StrategyPlanSet> {
    this.planCalls += 1;
    return Promise.resolve(fakePlanSet(userId, `plan-${this.planCalls}`));
  }
  replan(
    userId: string,
    _prior: StrategyPlanSet,
    _change: PlanChangeEvent,
    _research?: ResearchSignal,
  ): Promise<ReplanResult> {
    this.replanCalls += 1;
    return Promise.resolve({
      regenerated: true,
      planSet: fakePlanSet(userId, `replan-${this.replanCalls}`),
      explanation: `moved top-action earlier because change #${this.replanCalls}`,
    });
  }
}

class FakeMemory implements PlanMemoryPort {
  events: Array<{
    userId: string;
    horizon: PlanHorizonLike;
    priorPlanId: string | null;
    newPlanId: string;
    change: { type: string };
    diffSummary: string;
  }> = [];
  recordPlanRegenerated(input: {
    userId: string;
    horizon: PlanHorizonLike;
    priorPlanId: string | null;
    newPlanId: string;
    change: { type: string } & Record<string, unknown>;
    diffSummary: string;
  }): Promise<void> {
    this.events.push({
      userId: input.userId,
      horizon: input.horizon,
      priorPlanId: input.priorPlanId,
      newPlanId: input.newPlanId,
      change: { type: input.change.type },
      diffSummary: input.diffSummary,
    });
    return Promise.resolve();
  }
}

class FakeAudit implements AuditClient {
  entries: AuditRecord[] = [];
  private seq = 0;
  append(input: AuditRecordInput): Promise<AuditRecord> {
    const rec = Object.freeze({
      id: `audit-${++this.seq}`,
      at: new Date(this.seq * 1000).toISOString(),
      ...input,
    }) as unknown as AuditRecord;
    this.entries.push(rec);
    return Promise.resolve(rec);
  }
}

// --------- assembled deps ----------

function buildDeps(): {
  deps: PlanHandlerDeps;
  store: FakeStore;
  service: FakePlannerService;
  memory: FakeMemory;
  audit: FakeAudit;
} {
  const store = new FakeStore();
  const service = new FakePlannerService();
  const memory = new FakeMemory();
  const audit = new FakeAudit();
  const deps: PlanHandlerDeps = {
    // The port shapes are structural — the FakePlannerService quacks like
    // StrategicPlannerService on the two methods the handler calls.
    service: service as unknown as PlanHandlerDeps['service'],
    store: store,
    memory,
    audit,
  };
  return { deps, store, service, memory, audit };
}

// --------- tests ----------

describe('plan handlers — persistence + adaptive regeneration', () => {
  let ctx: RequestContext;

  beforeEach(() => {
    ctx = ctxUser(USER_A);
  });

  it('POST /v1/cie/plans generates and persists a full plan set + today\'s move', async () => {
    const { deps, service } = buildDeps();
    const res = await createPlans(ctx, {}, deps);
    expect(res.status).toBe(201);
    expect(service.planCalls).toBe(1);
    expect(res.body).toBeDefined();
    const body = res.body as { plans: unknown[]; todaysMove: { horizon: string; title: string } | null };
    expect(body.plans).toHaveLength(5);
    expect(body.todaysMove).not.toBeNull();
    expect(body.todaysMove?.horizon).toBe('30d');
  });

  it('GET /v1/cie/plans returns only active plans, ordered short→long', async () => {
    const { deps } = buildDeps();
    await createPlans(ctx, {}, deps);
    const res = await getPlans(ctx, deps);
    expect(res.status).toBe(200);
    const body = res.body as { plans: Array<{ horizon: string; status: string }> };
    expect(body.plans.map((p) => p.horizon)).toEqual(['30d', '90d', '1y', '3y', '5y']);
    for (const p of body.plans) expect(p.status).toBe('active');
  });

  it('GET /v1/cie/plans/:horizon returns 404 for unknown horizon and the plan for a valid one', async () => {
    const { deps } = buildDeps();
    await createPlans(ctx, {}, deps);
    const bad = await getPlanByHorizon(ctx, 'wat', deps);
    expect(bad.status).toBe(422);
    const good = await getPlanByHorizon(ctx, '30d', deps);
    expect(good.status).toBe(200);
    const body = good.body as { horizon: string };
    expect(body.horizon).toBe('30d');
  });

  it('POST /v1/cie/plans/:horizon/regenerate — MATERIAL change: supersede + explained diff + ONE MemoryEvent', async () => {
    const { deps, store, memory } = buildDeps();
    await createPlans(ctx, {}, deps);
    const prior = await store.getActivePlanByHorizon(USER_A, '30d');
    expect(prior).not.toBeNull();

    const change: PlanChangeEvent = { type: 'goal-added', goal: { id: 'g:new', statement: 'Ship X' } };
    const res = await regeneratePlan(ctx, '30d', { change }, deps);
    expect(res.status).toBe(200);
    const body = res.body as {
      regenerated: boolean;
      plan?: { id: string; horizon: string; diffSummary: string | null; rationale: string | null };
      explanation?: string;
    };
    expect(body.regenerated).toBe(true);
    expect(body.plan).toBeDefined();
    expect(body.plan?.diffSummary).toMatch(/moved top-action earlier/);
    expect(body.plan?.rationale).toBe(body.plan?.diffSummary);

    // prior superseded, new active
    const priorAfter = (await store.getActivePlans(USER_A)).find((p) => p.id === prior!.id);
    expect(priorAfter).toBeUndefined();

    // exactly ONE memory event, mentions the horizon + explanation
    expect(memory.events).toHaveLength(1);
    const ev = memory.events[0]!;
    expect(ev.horizon).toBe('30d');
    expect(ev.priorPlanId).toBe(prior!.id);
    expect(ev.newPlanId).toBe(body.plan!.id);
    expect(ev.diffSummary).toBe(body.plan!.diffSummary);
    expect(ev.change.type).toBe('goal-added');
  });

  it('POST /v1/cie/plans/:horizon/regenerate — SUB-THRESHOLD change: NO write, NO MemoryEvent (anti-thrash)', async () => {
    const { deps, store, memory, service } = buildDeps();
    await createPlans(ctx, {}, deps);
    const priorPlan = await store.getActivePlanByHorizon(USER_A, '30d');
    const priorPlanCalls = service.planCalls;
    const priorReplanCalls = service.replanCalls;

    const change: PlanChangeEvent = { type: 'cosmetic-edit', description: 'renamed' };
    const res = await regeneratePlan(ctx, '30d', { change }, deps);
    expect(res.status).toBe(200);
    const body = res.body as { regenerated: boolean };
    expect(body.regenerated).toBe(false);

    // prior plan unchanged
    const nowPlan = await store.getActivePlanByHorizon(USER_A, '30d');
    expect(nowPlan?.id).toBe(priorPlan!.id);
    // no MemoryEvent
    expect(memory.events).toHaveLength(0);
    // planner service was never re-invoked
    expect(service.planCalls).toBe(priorPlanCalls);
    expect(service.replanCalls).toBe(priorReplanCalls);
  });

  it('PATCH /v1/cie/plans/actions/:id — persists status + progress, 404 for unknown id', async () => {
    const { deps, store } = buildDeps();
    await createPlans(ctx, {}, deps);
    const plan = await store.getActivePlanByHorizon(USER_A, '30d');
    const actionId = plan!.actions[0]!.id;

    const upd = await patchPlanAction(ctx, actionId, { status: 'in_progress', progress: 42 }, deps);
    expect(upd.status).toBe(200);
    const body = upd.body as { status: string; progress: number };
    expect(body.status).toBe('in_progress');
    expect(body.progress).toBe(42);

    // Bad body → 422 (validation)
    const bad = await patchPlanAction(ctx, actionId, { status: 'bogus' }, deps);
    expect(bad.status).toBe(422);
    // Unknown id → 404
    const missing = await patchPlanAction(ctx, 'nope', { status: 'done' }, deps);
    expect(missing.status).toBe(404);
  });

  it('per-user scoping — user B cannot read user A\'s plan and vice versa', async () => {
    const { deps } = buildDeps();
    const ctxA = ctxUser(USER_A);
    const ctxB = ctxUser(USER_B);
    await createPlans(ctxA, {}, deps);
    const bList = await getPlans(ctxB, deps);
    expect(bList.status).toBe(200);
    const bBody = bList.body as { plans: unknown[] };
    expect(bBody.plans).toHaveLength(0);
    const bByHorizon = await getPlanByHorizon(ctxB, '30d', deps);
    expect(bByHorizon.status).toBe(404);
  });
});