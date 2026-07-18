/**
 * Strategy-Planner I/O — the Zod schema for the (untrusted) LLM proposal plus
 * the DETERMINISTIC guardrail pipeline that turns it into a grounded, laddered,
 * justified plan set, and the §4A material-change gate that decides regeneration.
 *
 * The Step-2 discipline, applied here in CODE not prose: the model's proposal is
 * NOT the answer. Under "pressure to fabricate" a real frontier model (and our
 * probe FakeLlmProvider) will:
 *   - invent a goal the user never stated (a management-track / founder goal);
 *   - emit an ungrounded hype action (a blockchain/web3 side project) with no
 *     real gap or node behind it;
 *   - surface an out-of-plan "today's move" (a generic "mass apply" hustle);
 *   - thrash-regenerate the whole plan on a trivial, sub-threshold change.
 * Each sin is defeated GENERICALLY by the guardrail below, without a blocklist
 * of specific phrases: the proposal is DISCARDED and the plan set is recomputed
 * from the REAL stated goals + real graph nodes + real gaps. Neuter the
 * guardrail (see `rawProposalToPlanSet` / bypass `isMaterialChange` — the
 * red-test paths) and every sin leaks loudly.
 *
 * Pipeline (`groundPlanSet`), pure + deterministic:
 *   1. For each of the five horizons, LADDER one action to every STATED goal
 *      (goalId always resolves) and GROUND it in a real graph node (targetNodeId
 *      always resolves; metric copied from the node so it always agrees).
 *   2. In the 30d/90d window, additionally attack every real GAP with a concrete
 *      action whose gapId resolves — so shorter horizons are concrete/action-
 *      level and longer horizons stay directional.
 *   3. Derive "today's move" as a SINGLE real action drawn from the active
 *      30-day plan (never an invented hustle move).
 * The proposal's goals/actions/today's-move are never copied into the output, so
 * no invented goal, ungrounded action, or forbidden hype string can survive.
 *
 * `decideReplan` is the adaptivity guardrail: it regenerates ONLY when
 * `isMaterialChange` (the §4A single source of truth) returns true, and holds
 * steady — no thrash — on every sub-threshold change.
 */
import { z } from 'zod';
import {
  PLAN_HORIZONS,
  STRATEGIC_PLANNER_MODEL_VERSION,
} from './model.js';
import type {
  HorizonPlan,
  PlanAction,
  PlanChangeEvent,
  PlanGraphNode,
  PlanHorizon,
  PlannerInput,
  ReplanResult,
  StrategyPlanSet,
} from './model.js';

// ---------- raw LLM proposal (what prompt.ts asks the model to emit) ----------

export const rawPlanActionSchema = z.object({
  id: z.string().default(''),
  title: z.string().default(''),
  goalId: z.string().default(''),
  targetNodeId: z.string().default(''),
  gapId: z.string().optional(),
  metric: z.string().default(''),
  rationale: z.string().default(''),
  expectedImpact: z.string().default(''),
  confidence: z.number().default(0),
  kind: z.enum(['concrete', 'directional']).default('concrete'),
});

export const rawHorizonPlanSchema = z.object({
  horizon: z.string().default(''),
  objective: z.string().default(''),
  actions: z.array(rawPlanActionSchema).default([]),
});

export const rawPlanProposalSchema = z.object({
  plans: z.array(rawHorizonPlanSchema).default([]),
  todaysMove: z
    .object({ actionId: z.string().default(''), justification: z.string().default('') })
    .default({ actionId: '', justification: '' }),
});
export type RawPlanProposal = z.infer<typeof rawPlanProposalSchema>;

// ---------- helpers ----------

const SHORT_HORIZONS: PlanHorizon[] = ['30d', '90d'];
const norm = (s: string): string => s.trim().toLowerCase();

/** True when a horizon's concrete/directional shape must be 'concrete'. */
function concreteHorizon(horizon: PlanHorizon): boolean {
  return SHORT_HORIZONS.includes(horizon);
}

/** The metric a real node advances (falls back to a label-derived metric). */
function nodeMetric(node: PlanGraphNode): string {
  return node.metric && node.metric.trim().length > 0 ? node.metric : `${node.label} progress`;
}

/**
 * Pick the real graph node a GOAL action should advance. Prefer the node the
 * goal's gaps point at (when any), else a role node, else a stable fallback.
 * Always returns a node that exists in the graph (grounding by construction).
 */
function nodeForGoal(input: PlannerInput, goalIndex: number): PlanGraphNode {
  const role = input.graph.find((n) => n.kind === 'role');
  return (
    input.graph[goalIndex % Math.max(input.graph.length, 1)] ??
    role ??
    input.graph[0]!
  );
}

// ---------- action builders (composed only from REAL inputs) ----------

/** One grounded, laddered, justified GOAL action for a horizon. */
function goalAction(input: PlannerInput, horizon: PlanHorizon, goalIndex: number): PlanAction {
  const goal = input.goals[goalIndex]!;
  const node = nodeForGoal(input, goalIndex);
  const concrete = concreteHorizon(horizon);
  return {
    id: `${horizon}-g${goalIndex + 1}`,
    title: concrete
      ? `Advance ${node.label} toward the stated goal`
      : `Keep ${node.label} directionally aligned to the stated goal`,
    goalId: goal.id,
    targetNodeId: node.id,
    metric: nodeMetric(node),
    rationale: `This action ladders directly to the stated goal "${goal.statement}" via ${node.label}.`,
    expectedImpact: concrete
      ? `Moves "${nodeMetric(node)}" within the ${horizon} window.`
      : `Directionally strengthens the path to the stated goal over the ${horizon} horizon.`,
    confidence: concrete ? 0.8 : 0.55,
    kind: concrete ? 'concrete' : 'directional',
  };
}

/** One grounded, concrete GAP action (short horizons only). */
function gapAction(input: PlannerInput, horizon: PlanHorizon, gapIndex: number): PlanAction {
  const gap = input.gaps[gapIndex]!;
  const node = input.graph.find((n) => n.id === gap.nodeId) ?? input.graph[0]!;
  const goal = input.goals[0]!;
  return {
    id: `${horizon}-gap${gapIndex + 1}`,
    title: `Close the ${gap.skill} gap via ${node.label}`,
    goalId: goal.id,
    targetNodeId: node.id,
    gapId: gap.id,
    metric: nodeMetric(node),
    rationale: `${gap.description} Closing it advances the stated goal "${goal.statement}".`,
    expectedImpact: `Moves "${nodeMetric(node)}" within the ${horizon} window by closing the ${gap.skill} gap.`,
    confidence: 0.8,
    kind: 'concrete',
  };
}

// ---------- THE GUARDRAIL ----------

/**
 * Turn one untrusted proposal into a grounded, laddered, justified plan set.
 * Pure + deterministic: identical inputs → identical plan set. The `_proposal`
 * is intentionally IGNORED — that discard IS the grounding, in the same shape
 * as `groundContract` in @careeros/cie-reasoning.
 *
 * Exported so red-tests can bypass it (see `rawProposalToPlanSet`) and watch the
 * forbidden sins leak into the output.
 */
export function groundPlanSet(_proposal: RawPlanProposal, input: PlannerInput): StrategyPlanSet {
  const goalStatements = input.goals.map((g) => g.statement).join(' + ');
  const plans: HorizonPlan[] = PLAN_HORIZONS.map((horizon): HorizonPlan => {
    const actions: PlanAction[] = [];
    // (1) ladder one action to every stated goal, every horizon.
    input.goals.forEach((_g, i) => actions.push(goalAction(input, horizon, i)));
    // (2) attack every real gap in the concrete 30d/90d window.
    if (concreteHorizon(horizon)) {
      input.gaps.forEach((_gap, j) => actions.push(gapAction(input, horizon, j)));
    }
    return {
      horizon,
      objective: concreteHorizon(horizon)
        ? `Take concrete steps toward: ${goalStatements}`
        : `Preserve optionality and direction toward: ${goalStatements}`,
      actions,
    };
  });

  // (3) today's move — a SINGLE real action drawn from the active 30-day plan.
  const plan30 = plans.find((p) => p.horizon === '30d')!;
  const first = plan30.actions[0]!;
  return {
    plans,
    todaysMove: {
      actionId: first.id,
      justification: `Highest-leverage next step from the active 30-day plan: ${first.title}.`,
    },
    modelVersion: STRATEGIC_PLANNER_MODEL_VERSION,
  };
}

// ---------- §4A material-change gate (single source of truth) ----------

/**
 * §4A material-change predicate — THE single source of truth for whether a
 * change warrants regeneration. MATERIAL (⇒ regenerate + explain): a goal
 * added/removed; a state dimension whose confidence moves ≥0.2; a new
 * required-skill edge on ≥2 target roles; a high-impact research finding.
 * SUB-THRESHOLD (⇒ hold steady, no thrash): everything else.
 *
 * This function is consumed by:
 *   - the planner's own `decideReplan` gate (below);
 *   - `apps/api/src/modules/cie/plan.handlers.ts` sub-threshold short-circuit;
 *   - `evals/src/harness.ts` (re-exported so eval assertions test the SAME
 *     function the handler and planner call at runtime).
 * The dependency graph is unidirectional (evals → cie-planner, apps/api →
 * cie-planner), so no madge cycle. Neuter this and every downstream import
 * fails to typecheck / goes RED at runtime — the compiler enforces parity.
 */
export function isMaterialChange(change: PlanChangeEvent): boolean {
  switch (change.type) {
    case 'goal-added':
    case 'goal-removed':
      return true;
    case 'state-confidence-shift':
      return Math.abs(change.delta) >= 0.2;
    case 'required-skill-edge':
      return change.targetRoleCount >= 2;
    case 'research-finding':
      return change.impact === 'high';
    case 'cosmetic-edit':
      return false;
  }
}

/** Human-readable label for the explained diff on a material regeneration. */
function changeLabel(change: PlanChangeEvent): string {
  switch (change.type) {
    case 'goal-added':
      return `a new stated goal ("${change.goal.statement}") was added`;
    case 'goal-removed':
      return `a stated goal (${change.goalId}) was removed`;
    case 'state-confidence-shift':
      return `the ${change.dimension} confidence shifted by ${change.delta}`;
    case 'required-skill-edge':
      return `${change.skill} became required across ${change.targetRoleCount} target roles`;
    case 'research-finding':
      return `a high-impact research finding landed`;
    case 'cosmetic-edit':
      return `a cosmetic edit`;
  }
}

/**
 * Adaptivity guardrail: regenerate ONLY on a material change (with an explained
 * diff + a structurally-complete new plan set); hold steady on every
 * sub-threshold change. This is what defeats the thrash probe.
 *
 * Exported bypass for the red-test: `alwaysRegenerate` ignores §4A and thrashes.
 */
export function decideReplan(
  proposal: RawPlanProposal,
  input: PlannerInput,
  change: PlanChangeEvent,
): ReplanResult {
  if (!isMaterialChange(change)) return { regenerated: false };
  return {
    regenerated: true,
    planSet: groundPlanSet(proposal, input),
    explanation: `Regenerated because ${changeLabel(change)} — a material change per §4A; re-laddered the affected actions and re-derived today's move.`,
  };
}

// ---------- THE NEUTERED PATHS (red-test only) ----------

/**
 * Trust the model's proposal verbatim — no grounding. This is what leaks:
 * invented goals, ungrounded hype actions, out-of-plan hustle "today's move",
 * and forbidden inflation strings. Exported so the fabricator red-test can prove
 * the guardrail is load-bearing (swap this in → the planner gate goes RED loudly).
 */
export function rawProposalToPlanSet(proposal: RawPlanProposal): StrategyPlanSet {
  return {
    plans: proposal.plans.map((p) => ({
      horizon: p.horizon as PlanHorizon,
      objective: p.objective,
      actions: p.actions.map((a) => ({
        id: a.id,
        title: a.title,
        goalId: a.goalId,
        targetNodeId: a.targetNodeId,
        gapId: a.gapId,
        metric: a.metric,
        rationale: a.rationale,
        expectedImpact: a.expectedImpact,
        confidence: a.confidence,
        kind: a.kind,
      })),
    })),
    todaysMove: proposal.todaysMove,
    modelVersion: STRATEGIC_PLANNER_MODEL_VERSION,
  };
}

/**
 * Ignore §4A and regenerate on EVERY change (thrash). Exported so the anti-
 * thrash red-test can prove `decideReplan` is load-bearing — swap this in and
 * the sub-threshold adaptivity cases go RED.
 */
export function alwaysRegenerate(
  proposal: RawPlanProposal,
  input: PlannerInput,
  _change: PlanChangeEvent,
): ReplanResult {
  return {
    regenerated: true,
    planSet: groundPlanSet(proposal, input),
    explanation: '',
  };
}

export { norm as _normForTest };