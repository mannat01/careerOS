/**
 * Self-validation agents for the M06 (strategy-planner) harness.
 *
 * These are NOT the real Step-2 planner — they exist to prove the HARNESS
 * itself discriminates good from bad before any real agent lands (the same
 * discipline as the M02/M03/M05 harness self-tests):
 *   - ORACLE planner builds a fully-grounded plan set straight from the case
 *     input (stated goals, real graph nodes, real gaps). A correct harness
 *     must pass it on every case, and it applies the §4A material-change rule
 *     exactly on replan.
 *   - FABRICATOR planner invents a goal the user never stated, recommends an
 *     action ungrounded in any real gap/node, surfaces a hustle "today's move"
 *     outside the 30-day plan, and regenerates on a trivial change (thrash).
 *     A correct harness must CATCH every one of those.
 *   - STUB planner produces empty/degenerate output so the eval GATE is
 *     runnable (and RED) before the real planner exists.
 *
 * All are deterministic (no LLM).
 */
import { isMaterialChange } from './harness.js';
import type {
  HorizonPlan,
  PlanAction,
  PlanHorizon,
  PlannerAgent,
  PlannerInput,
  StrategyPlanSet,
} from './types.js';

const HORIZONS: PlanHorizon[] = ['30d', '90d', '1y', '3y', '5y'];

// ============================================================================
// ORACLE — fully grounded, laddered, justified plan set derived from the input.
// ============================================================================

function oracleAction(
  input: PlannerInput,
  horizon: PlanHorizon,
  index: number,
): PlanAction {
  const concrete = horizon === '30d' || horizon === '90d';
  const goal = input.goals[index % input.goals.length] ?? { id: 'g-none', statement: 'no stated goal' };
  // Short horizons attack gaps; long horizons advance role/skill nodes directionally.
  const gap = input.gaps.length > 0 ? input.gaps[index % input.gaps.length] : undefined;
  const fallbackNode = { id: 'n-none', kind: 'skill' as const, label: 'none', metric: 'none' };
  const node =
    (concrete && gap
      ? input.graph.find((n) => n.id === gap.nodeId) ?? input.graph[0]
      : input.graph[index % Math.max(input.graph.length, 1)]) ?? fallbackNode;
  return {
    id: `${horizon}-a${index + 1}`,
    title: concrete
      ? `Close the ${gap?.skill ?? node.label} gap via ${node.label}`
      : `Deepen ${node.label} toward "${goal.statement}"`,
    goalId: goal.id,
    targetNodeId: node.id,
    gapId: concrete && gap ? gap.id : undefined,
    metric: node.metric ?? `${node.label} progress`,
    rationale: concrete
      ? `${gap?.description ?? node.label} — closing this directly advances "${goal.statement}".`
      : `Sustained investment in ${node.label} preserves optionality toward "${goal.statement}".`,
    expectedImpact: concrete
      ? `Moves "${node.metric ?? node.label}" within the ${horizon} window.`
      : `Directionally strengthens the path to "${goal.statement}".`,
    confidence: concrete ? 0.8 : 0.6,
    kind: concrete ? 'concrete' : 'directional',
  };
}

function oraclePlanSet(input: PlannerInput): StrategyPlanSet {
  const plans: HorizonPlan[] = HORIZONS.map((horizon) => {
    // Enough actions to cover every stated goal and (in 30d/90d) every gap.
    const count = Math.max(input.goals.length, input.gaps.length, 1);
    const actions = Array.from({ length: count }, (_, i) => oracleAction(input, horizon, i));
    return {
      horizon,
      objective: `Advance toward: ${input.goals.map((g) => g.statement).join(' + ')}`,
      actions,
    };
  });
  const first30 = plans[0]?.actions[0];
  return {
    plans,
    todaysMove: {
      actionId: first30?.id ?? '',
      justification: `Highest-leverage next step from the active 30-day plan: ${first30?.title ?? ''}.`,
    },
  };
}

/** Oracle planner: grounded, laddered, justified; replans exactly per §4A. */
export const oraclePlannerAgent: PlannerAgent = {
  plan(input) {
    return Promise.resolve(oraclePlanSet(input));
  },
  replan(input, _prior, change) {
    if (!isMaterialChange(change)) return Promise.resolve({ regenerated: false });
    return Promise.resolve({
      regenerated: true,
      planSet: oraclePlanSet(input),
      explanation: `Regenerated because a material change occurred (${change.type}): moved the affected actions earlier to address it.`,
    });
  },
};

// ============================================================================
// FABRICATOR — invents goals, ungrounded actions, hustle today's-move; thrashes.
// ============================================================================

/**
 * Fabricator planner: everything the golden set forbids —
 *   - LADDERS to an INVENTED goal ('goal-invented') the user never stated;
 *   - recommends an action targeting a node/gap that does not exist
 *     (hype project ungrounded in any real gap);
 *   - emits forbidden inflation strings in titles/rationales;
 *   - "today's move" is a generic hustle action NOT in the 30-day plan;
 *   - regenerates on ANY change, however trivial (thrash), without explanation.
 */
export const fabricatorPlannerAgent: PlannerAgent = {
  plan(input) {
    const forbiddenBait =
      'Pursue the management track: become a manager. Spin up a blockchain / web3 crypto side project. ' +
      'Mass apply to 100 jobs and cold-email 50 recruiters. Pivot to prompt engineering via a prompt engineer bootcamp.';
    const plans: HorizonPlan[] = HORIZONS.map((horizon) => ({
      horizon,
      objective: `Chase momentum regardless of stated goals (${horizon}).`,
      actions: [
        {
          id: `${horizon}-fab1`,
          title: 'Ladder to a goal the user never stated',
          goalId: 'goal-invented', // does NOT resolve to a stated goal
          targetNodeId: input.graph[0]?.id ?? 'n-any',
          metric: input.graph[0]?.metric ?? 'progress',
          rationale: forbiddenBait,
          expectedImpact: 'Vibes.',
          confidence: 0.99,
          kind: 'concrete', // wrong shape on long horizons too
        },
        {
          id: `${horizon}-fab2`,
          title: 'Hype project ungrounded in any real gap',
          goalId: input.goals[0]?.id ?? 'g1',
          targetNodeId: 'n-nonexistent-hype', // does NOT resolve to a graph node
          gapId: 'gap-nonexistent', // does NOT resolve to a real gap
          metric: 'hype generated',
          rationale: 'Everyone is doing it.',
          expectedImpact: 'Unknown but exciting.',
          confidence: 0.95,
          kind: 'concrete',
        },
      ],
    }));
    return Promise.resolve({
      plans,
      todaysMove: {
        // NOT an action in the 30-day plan — an invented generic hustle move.
        actionId: 'todays-hustle-move',
        justification: 'Mass apply to 100 jobs today and cold-email 50 recruiters!',
      },
    });
  },
  replan(_input, prior, _change) {
    // Thrash: regenerate on EVERY change, even trivial ones, with no explanation.
    return Promise.resolve({ regenerated: true, planSet: prior, explanation: '' });
  },
};

// ============================================================================
// STUB — deliberate degenerate output; keeps the eval gate runnable (and RED).
// ============================================================================

/** Stub planner: empty plan set. RED-by-design until the Step-2 planner lands. */
export class StubPlannerAgent implements PlannerAgent {
  plan(_input: PlannerInput): Promise<StrategyPlanSet> {
    return Promise.resolve({
      plans: [],
      todaysMove: { actionId: '', justification: '' },
    });
  }
  replan(): Promise<{ regenerated: boolean }> {
    // Never regenerates — fails the material-change cases.
    return Promise.resolve({ regenerated: false });
  }
}