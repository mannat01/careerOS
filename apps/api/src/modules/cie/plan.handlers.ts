/**
 * M06 Stage-6 Step-3 — Strategy Plan handlers + endpoints.
 *
 * The Strategy-Planner service (packages/cie/planner) is a PURE reasoning
 * skill-agent; it never persists. This module is the app-side seam that:
 *   1. Assembles the planner input via NARROW PORTS (facts/state/goals/graph)
 *      that the caller wires to real services (MemoryService, CareerStateService,
 *      GraphMemoryService). The handler itself is DB-free.
 *   2. Persists the planner's grounded per-horizon output through the narrow
 *      `StrategyPlanStorePort` (PrismaStrategyPlanStore in @careeros/db) with
 *      ONE active plan per horizon (partial-unique on `status='active'`).
 *   3. On regenerate, uses the planner package's §4A `decideReplan` gate to
 *      decide MATERIAL vs sub-threshold; on material, supersedes the prior plan
 *      (stores a diff summary + rationale on the new row) AND appends ONE
 *      episodic `MemoryEvent` describing what changed. On sub-threshold, no-op
 *      — no write, no MemoryEvent, no thrash.
 *   4. Exposes `today's move` as the top-ordered action from the active 30-day
 *      plan.
 *
 * PER-USER by construction: `userId` flows from the verified `RequestContext`;
 * callers never supply it. Cross-user reads/writes are impossible at the
 * store boundary (all reads/writes are `where userId = ctx.userId`).
 *
 * Advisory Green: acting on a plan action stays Yellow/Red elsewhere; this
 * endpoint set is read-only advisory + persistence of the derived plan.
 *
 * FOLLOW-UP (recorded in the build log): the §4A material-change predicate is
 * duplicated in evals/src/harness.ts and packages/cie/planner/src/io.ts to keep
 * a madge cycle out of `evals ↔ cie-planner`. Both must move in lock-step. A
 * follow-up will lift `isMaterialChange` into a shared, tiny package that both
 * consume, deleting the duplication and letting the compiler enforce parity.
 */
import type { AuditClient } from '@careeros/observability';
import type {
  PlanChangeEvent,
  PlanGraphNode,
  PlannerAgent,
  PlannerFactPort,
  PlannerGoalPort,
  PlannerGraphPort,
  PlannerProfileFact,
  PlannerStateDimension,
  PlannerStatePort,
  ReplanResult,
  ResearchSignal,
  SkillGap,
  StatedGoal,
  StrategicPlannerService,
  StrategyPlanSet,
} from '@careeros/cie-planner';
import {
  PLAN_HORIZONS,
  STRATEGIC_PLANNER_MODEL_VERSION,
  isMaterialChange,
} from '@careeros/cie-planner';
import type {
  PersistPlanActionLike,
  PersistPlanLike,
  PlanActionKindLike,
  PlanActionRecordLike,
  PlanActionStatusLike,
  PlanHorizonLike,
  StrategyPlanRecordLike,
  StrategyPlanStorePortShape,
} from '@careeros/db';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';

// ---------------- narrow ports (adapters live in bootstrap) ----------------

/** Advisory episodic-memory port — one method wide (append a memory event). */
export interface PlanMemoryPort {
  recordPlanRegenerated(input: {
    userId: string;
    horizon: PlanHorizonLike;
    priorPlanId: string | null;
    newPlanId: string;
    change: PlanChangeEvent;
    diffSummary: string;
  }): Promise<void>;
}

export interface PlanHandlerDeps {
  service: StrategicPlannerService;
  store: StrategyPlanStorePortShape;
  memory: PlanMemoryPort;
  audit: AuditClient;
}

// ---------------- domain response shapes ----------------

/** One horizon plan + actions the API returns (mirrors the store record). */
export type PlanResponse = StrategyPlanRecordLike;

/** Full plan-set response + today's move (top action of the active 30d plan). */
export interface PlanSetResponse {
  plans: PlanResponse[];
  todaysMove: { actionId: string; horizon: PlanHorizonLike; title: string } | null;
}

// ---------------- POST /v1/cie/plans — first-generation (or force regenerate all) ----------------

/**
 * Compose a plan set for the caller and persist it. If any active plans exist,
 * they are SUPERSEDED (with an empty diff — the caller asked for a full
 * regeneration). Use POST /:horizon/regenerate for change-driven, §4A-gated
 * regenerations that carry an explained diff.
 */
export async function createPlans(
  ctx: RequestContext,
  body: unknown,
  deps: PlanHandlerDeps,
): Promise<HandlerResponse<PlanSetResponse>> {
  const research = parseResearch(body);
  const planSet = await deps.service.plan(ctx.userId, research);
  const persistPlans = planSetToPersist(planSet, { diffSummary: null, rationale: 'Initial plan generation.' });
  const stored = await deps.store.writeActivePlans(ctx.userId, persistPlans);
  await deps.audit.append({
    userId: ctx.userId,
    actor: 'user',
    action: 'cie.plan.generate',
    target: ctx.userId,
    reason: `Generated ${stored.length} horizon plans (initial).`,
    modelVersion: planSet.modelVersion ?? STRATEGIC_PLANNER_MODEL_VERSION,
    traceId: ctx.traceId,
  });
  return { status: 201, body: buildPlanSetResponse(stored) };
}

// ---------------- GET /v1/cie/plans — all active + today's move ----------------

export async function getPlans(
  ctx: RequestContext,
  deps: PlanHandlerDeps,
): Promise<HandlerResponse<PlanSetResponse>> {
  const plans = await deps.store.getActivePlans(ctx.userId);
  return ok(buildPlanSetResponse(plans));
}

// ---------------- GET /v1/cie/plans/:horizon — one active plan ----------------

export async function getPlanByHorizon(
  ctx: RequestContext,
  horizon: string,
  deps: PlanHandlerDeps,
): Promise<HandlerResponse<PlanResponse>> {
  const parsed = parseHorizon(horizon);
  if (!parsed) {
    return errorResponse('validation_failed', 'Unknown horizon.', {
      details: { expected: PLAN_HORIZONS },
      traceId: ctx.traceId,
    });
  }
  const found = await deps.store.getActivePlanByHorizon(ctx.userId, parsed);
  if (!found) {
    return errorResponse('not_found', 'No active plan for that horizon.', {
      details: { horizon: parsed },
      traceId: ctx.traceId,
    });
  }
  return ok(found);
}

// ---------------- POST /v1/cie/plans/:horizon/regenerate — §4A-gated ----------------

/**
 * Change-driven regeneration for ONE horizon. Body carries the `PlanChangeEvent`.
 * The §4A `isMaterialChange` gate lives in @careeros/cie-planner — MATERIAL
 * ⇒ regenerate (supersede, store diff + rationale, emit MemoryEvent); SUB-
 * THRESHOLD ⇒ 200 { regenerated: false } and NO writes (no thrash). The plan
 * is only ever ONE per horizon-active thanks to the partial-unique index.
 */
export async function regeneratePlan(
  ctx: RequestContext,
  horizon: string,
  body: unknown,
  deps: PlanHandlerDeps,
): Promise<HandlerResponse<{ regenerated: boolean; plan?: PlanResponse; explanation?: string }>> {
  const parsedHorizon = parseHorizon(horizon);
  if (!parsedHorizon) {
    return errorResponse('validation_failed', 'Unknown horizon.', {
      details: { expected: PLAN_HORIZONS },
      traceId: ctx.traceId,
    });
  }
  const parsedBody = parseRegenerateBody(body);
  if (!parsedBody) {
    return errorResponse('validation_failed', 'Expected { change: PlanChangeEvent }.', {
      traceId: ctx.traceId,
    });
  }

  const prior = await deps.store.getActivePlanByHorizon(ctx.userId, parsedHorizon);

  // Sub-threshold short-circuit — never hit the planner, never write.
  if (!isMaterialChange(parsedBody.change)) {
    await deps.audit.append({
      userId: ctx.userId,
      actor: 'user',
      action: 'cie.plan.regenerate.skipped',
      target: ctx.userId,
      reason: `Sub-threshold change (${parsedBody.change.type}) — held plan steady.`,
      modelVersion: STRATEGIC_PLANNER_MODEL_VERSION,
      traceId: ctx.traceId,
    });
    return ok({ regenerated: false });
  }

  // Material — run the planner (its own decideReplan mirrors this §4A gate).
  // The planner needs the current prior plan-set object as its diff basis.
  const priorPlanSet: StrategyPlanSet = prior
    ? recordToStrategyPlanSet(prior)
    : emptyPlanSet();
  const replan: ReplanResult = await deps.service.replan(
    ctx.userId,
    priorPlanSet,
    parsedBody.change,
    parsedBody.research,
  );
  if (!replan.regenerated || !replan.planSet) {
    // Defensive: the two §4A gates must agree. If they don't, don't write.
    return ok({ regenerated: false });
  }

  const explanation = replan.explanation ?? '';
  const horizonPlan = replan.planSet.plans.find((p) => p.horizon === parsedHorizon);
  if (!horizonPlan) {
    return errorResponse('validation_failed', 'Planner did not return the requested horizon.', {
      details: { horizon: parsedHorizon },
      traceId: ctx.traceId,
    });
  }
  const persist: PersistPlanLike = horizonPlanToPersist(horizonPlan, {
    diffSummary: explanation,
    rationale: explanation,
  });
  const [stored] = await deps.store.writeActivePlans(ctx.userId, [persist]);
  if (!stored) {
    return errorResponse('internal', 'Failed to persist regenerated plan.', {
      traceId: ctx.traceId,
    });
  }

  // Adaptive: append ONE episodic MemoryEvent — the "why" of the regeneration.
  await deps.memory.recordPlanRegenerated({
    userId: ctx.userId,
    horizon: parsedHorizon,
    priorPlanId: prior?.id ?? null,
    newPlanId: stored.id,
    change: parsedBody.change,
    diffSummary: explanation,
  });

  await deps.audit.append({
    userId: ctx.userId,
    actor: 'user',
    action: 'cie.plan.regenerate',
    target: stored.id,
    reason: `Material change (${parsedBody.change.type}) regenerated ${parsedHorizon} plan.`,
    modelVersion: replan.planSet.modelVersion ?? STRATEGIC_PLANNER_MODEL_VERSION,
    traceId: ctx.traceId,
  });

  return ok({ regenerated: true, plan: stored, explanation });
}

// ---------------- PATCH /v1/cie/plans/actions/:id — status/progress ----------------

export async function patchPlanAction(
  ctx: RequestContext,
  actionId: string,
  body: unknown,
  deps: PlanHandlerDeps,
): Promise<HandlerResponse<PlanActionRecordLike>> {
  const patch = parseActionPatch(body);
  if (!patch) {
    return errorResponse('validation_failed', 'Expected { status?, progress? }.', {
      traceId: ctx.traceId,
    });
  }
  const updated = await deps.store.updateAction(ctx.userId, actionId, patch);
  if (!updated) {
    return errorResponse('not_found', 'Plan action not found.', {
      details: { id: actionId },
      traceId: ctx.traceId,
    });
  }
  return ok(updated);
}

// ---------------- helpers: mapping planner ↔ store ----------------

/** Map a full StrategyPlanSet into per-horizon persist inputs. */
function planSetToPersist(
  set: StrategyPlanSet,
  meta: { diffSummary: string | null; rationale: string | null },
): PersistPlanLike[] {
  return set.plans.map((p) => horizonPlanToPersist(p, meta));
}

function horizonPlanToPersist(
  horizon: StrategyPlanSet['plans'][number],
  meta: { diffSummary: string | null; rationale: string | null },
): PersistPlanLike {
  const goalRefs = Array.from(new Set(horizon.actions.map((a) => a.goalId)));
  const actions: PersistPlanActionLike[] = horizon.actions.map((a, idx) => ({
    actionKey: a.id,
    kind: kindForAction(a.targetNodeId),
    title: a.title,
    rationale: a.rationale,
    orderIndex: idx,
    evidenceRefs: [a.goalId, a.targetNodeId, ...(a.gapId ? [a.gapId] : [])],
  }));
  return {
    horizon: horizon.horizon,
    summary: horizon.objective,
    goalRefs,
    diffSummary: meta.diffSummary,
    rationale: meta.rationale,
    modelVersion: STRATEGIC_PLANNER_MODEL_VERSION,
    actions,
  };
}

/**
 * The planner doesn't expose the node kind in the action shape — we normalize
 * to `'other'`. Callers who want typed adherence (skill/cert/project/…) can
 * still bucket via `evidenceRefs` on the node label. Kept a pure function so
 * the store row is deterministic given the planner output.
 */
function kindForAction(_targetNodeId: string): PlanActionKindLike {
  return 'other';
}

/** Reconstruct a minimal StrategyPlanSet from a stored record for replan basis. */
function recordToStrategyPlanSet(record: StrategyPlanRecordLike): StrategyPlanSet {
  return {
    plans: [
      {
        horizon: record.horizon,
        objective: record.summary,
        actions: record.actions.map((a) => ({
          id: a.actionKey,
          title: a.title,
          goalId: firstString(a.evidenceRefs) ?? 'unknown',
          targetNodeId: a.evidenceRefs[1] ?? 'unknown',
          gapId: a.evidenceRefs[2],
          metric: '',
          rationale: a.rationale,
          expectedImpact: '',
          confidence: 0.5,
          kind: 'concrete',
        })),
      },
    ],
    todaysMove: {
      actionId: record.actions[0]?.actionKey ?? '',
      justification: '',
    },
    modelVersion: record.modelVersion,
  };
}

function firstString(arr: string[]): string | undefined {
  return arr.length > 0 ? arr[0] : undefined;
}

function emptyPlanSet(): StrategyPlanSet {
  return {
    plans: [],
    todaysMove: { actionId: '', justification: '' },
    modelVersion: STRATEGIC_PLANNER_MODEL_VERSION,
  };
}

/**
 * Build the full plan-set response. "Today's move" is the TOP-ordered action
 * from the ACTIVE 30-day plan, if one exists.
 */
function buildPlanSetResponse(plans: StrategyPlanRecordLike[]): PlanSetResponse {
  const p30 = plans.find((p) => p.horizon === '30d');
  const top = p30?.actions[0];
  const todaysMove = top
    ? { actionId: top.id, horizon: '30d' as PlanHorizonLike, title: top.title }
    : null;
  return { plans, todaysMove };
}

// ---------------- parsers ----------------

function parseHorizon(input: string): PlanHorizonLike | null {
  return (PLAN_HORIZONS as readonly string[]).includes(input) ? (input as PlanHorizonLike) : null;
}

function parseResearch(body: unknown): ResearchSignal | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const b = body as Record<string, unknown>;
  const r = b.research;
  if (typeof r !== 'object' || r === null) return undefined;
  const rr = r as Record<string, unknown>;
  const id = typeof rr.id === 'string' ? rr.id : undefined;
  const summary = typeof rr.summary === 'string' ? rr.summary : undefined;
  const impact = rr.impact === 'high' || rr.impact === 'low' ? rr.impact : undefined;
  if (!id || !summary || !impact) return undefined;
  return { id, summary, impact };
}

function parseRegenerateBody(
  body: unknown,
): { change: PlanChangeEvent; research?: ResearchSignal } | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const change = parseChange(b.change);
  if (!change) return null;
  return { change, research: parseResearch(b) };
}

function parseChange(input: unknown): PlanChangeEvent | null {
  if (typeof input !== 'object' || input === null) return null;
  const c = input as Record<string, unknown>;
  switch (c.type) {
    case 'goal-added': {
      const goal = c.goal;
      if (typeof goal !== 'object' || goal === null) return null;
      const g = goal as Record<string, unknown>;
      if (typeof g.id !== 'string' || typeof g.statement !== 'string') return null;
      return {
        type: 'goal-added',
        goal: {
          id: g.id,
          statement: g.statement,
          timeframe: typeof g.timeframe === 'string' ? g.timeframe : undefined,
        },
      };
    }
    case 'goal-removed':
      return typeof c.goalId === 'string' ? { type: 'goal-removed', goalId: c.goalId } : null;
    case 'state-confidence-shift':
      if (typeof c.dimension !== 'string' || typeof c.delta !== 'number') return null;
      return { type: 'state-confidence-shift', dimension: c.dimension, delta: c.delta };
    case 'required-skill-edge':
      if (typeof c.skill !== 'string' || typeof c.targetRoleCount !== 'number') return null;
      return {
        type: 'required-skill-edge',
        skill: c.skill,
        targetRoleCount: c.targetRoleCount,
      };
    case 'research-finding':
      if (c.impact !== 'high' && c.impact !== 'low') return null;
      if (typeof c.summary !== 'string') return null;
      return { type: 'research-finding', impact: c.impact, summary: c.summary };
    case 'cosmetic-edit':
      return {
        type: 'cosmetic-edit',
        description: typeof c.description === 'string' ? c.description : '',
      };
    default:
      return null;
  }
}

function parseActionPatch(
  body: unknown,
): { status?: PlanActionStatusLike; progress?: number } | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const patch: { status?: PlanActionStatusLike; progress?: number } = {};
  if (b.status !== undefined) {
    const s = b.status;
    if (s !== 'suggested' && s !== 'in_progress' && s !== 'done' && s !== 'dropped') return null;
    patch.status = s;
  }
  if (b.progress !== undefined) {
    const p = b.progress;
    if (typeof p !== 'number' || p < 0 || p > 100) return null;
    patch.progress = Math.round(p);
  }
  if (patch.status === undefined && patch.progress === undefined) return null;
  return patch;
}

// ---------------- re-exports for adapters in bootstrap ----------------

export type {
  PlannerAgent,
  PlannerFactPort,
  PlannerGoalPort,
  PlannerGraphPort,
  PlannerProfileFact,
  PlannerStateDimension,
  PlannerStatePort,
  PlanGraphNode,
  SkillGap,
  StatedGoal,
};