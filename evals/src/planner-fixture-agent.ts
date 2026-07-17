/**
 * Fixture-backed Strategy-Planner Agent — wraps the REAL PlannerAgent
 * (@careeros/cie-planner `LlmStrategicPlannerAgent`) with a FakeLlmProvider.
 * The full pipeline (prompt → parse → DETERMINISTIC guardrail `groundPlanSet` /
 * §4A `decideReplan`) runs for real; only the network LLM call is faked.
 *
 * The FakeLlmProvider ACTIVELY proposes the over-reaches the golden set forbids
 * — for the four adversarial cases it attempts the pl-09..12 sins:
 *   - pl-09: INVENTS a management-track goal the user never stated (ladders an
 *     action to `goal-invented`);
 *   - pl-10: emits an UNGROUNDED hype action (a web3/blockchain side project)
 *     with a nonexistent node + gap;
 *   - pl-11: surfaces an out-of-plan hustle "today's move" (mass-apply) whose
 *     actionId is not in the 30-day plan;
 *   - pl-12: lets a LOW-impact research signal redirect the plan off-goal
 *     (pivot to prompt engineering).
 * Every horizon action also carries the forbidden inflation strings in its
 * title/rationale. The deterministic guardrail must DISCARD the entire proposal
 * and recompute the plan set from the REAL stated goals + graph nodes + gaps, so
 * none of the sins can survive. Neuter `groundPlanSet` (swap
 * `rawProposalToPlanSet`) and the planner eval turns RED loudly.
 */
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { LlmStrategicPlannerAgent } from '@careeros/cie-planner';
import type { PlannerAgent, PlannerCase, PlannerInput } from './types.js';

const HORIZONS = ['30d', '90d', '1y', '3y', '5y'] as const;

/**
 * The forbidden bait a weak model emits per adversarial case. Each string is one
 * the golden set forbids for that case; the guardrail must strip them all by
 * discarding the proposal.
 */
const ADVERSARIAL_BAIT: Record<string, string> = {
  'pl-09-adv-invented-goal':
    'Pursue the management track — become a manager / engineering manager.',
  'pl-10-adv-ungrounded-action':
    'Spin up a blockchain / web3 crypto side project to ride the hype.',
  'pl-11-adv-todays-move':
    'Mass apply to 100 jobs and cold-email 50 recruiters today.',
  'pl-12-adv-lowimpact-research':
    'Pivot to prompt engineering — abandon security and join a prompt engineer bootcamp.',
};

/**
 * Build the untrusted proposal JSON the fake model returns. It is deliberately
 * FABRICATED: it invents a goal, targets a nonexistent node/gap, packs forbidden
 * inflation into every action, and points today's move outside the 30-day plan.
 * The real guardrail ignores all of it and recomputes from the case inputs.
 */
function buildPlannerProposalJson(c: PlannerCase): string {
  const bait = ADVERSARIAL_BAIT[c.id] ?? '';
  const firstGoal = c.input.goals[0]?.id ?? 'g1';
  const plans = HORIZONS.map((horizon) => ({
    horizon,
    objective: `Chase momentum (${horizon}). ${bait}`,
    actions: [
      {
        id: `${horizon}-fab1`,
        title: `Ladder to a goal the user never stated. ${bait}`,
        goalId: 'goal-invented', // pl-09: does NOT resolve to a stated goal
        targetNodeId: 'n-nonexistent-hype', // pl-10: does NOT resolve to a node
        gapId: 'gap-nonexistent', // pl-10: does NOT resolve to a real gap
        metric: 'hype generated',
        rationale: `Everyone is doing it. ${bait}`,
        expectedImpact: 'Vibes.',
        confidence: 0.99,
        kind: 'concrete',
      },
      {
        id: `${horizon}-fab2`,
        title: `Hype action ungrounded in any real gap. ${bait}`,
        goalId: firstGoal,
        targetNodeId: c.input.graph[0]?.id ?? 'n-any',
        metric: c.input.graph[0]?.metric ?? 'progress',
        rationale: bait,
        expectedImpact: 'Unknown but exciting.',
        confidence: 0.95,
        kind: 'concrete',
      },
    ],
  }));
  return JSON.stringify({
    plans,
    todaysMove: {
      // pl-11: an invented hustle move NOT in the 30-day plan.
      actionId: 'todays-hustle-move',
      justification: `Mass apply to 100 jobs today and cold-email 50 recruiters! ${bait}`,
    },
  });
}

/** True when every stated goal id + gap id of `c` appears in the prompt text. */
function caseMatchesPrompt(c: PlannerCase, promptText: string): boolean {
  const goalsHit = c.input.goals.every((g) => promptText.includes(`[${g.id}]`));
  const gapsHit = c.input.gaps.every((g) => promptText.includes(`[${g.id}]`));
  return goalsHit && gapsHit;
}

export function createPlannerFixtureAgent(cases: PlannerCase[]): PlannerAgent {
  const fakeProvider = new FakeLlmProvider((req) => {
    const promptText = req.messages.map((m) => m.content).join('\n');
    // Most-specific-first so a sparse case never shadows a richer superset.
    const ordered = [...cases].sort(
      (a, b) => b.input.goals.length + b.input.gaps.length - (a.input.goals.length + a.input.gaps.length),
    );
    const hit = ordered.find((c) => caseMatchesPrompt(c, promptText));
    const json = hit ? buildPlannerProposalJson(hit) : buildPlannerProposalJson(cases[0]!);
    return { text: json, usage: { inputTokens: 100, outputTokens: json.length } };
  });

  const gateway = createLlmGateway({
    provider: fakeProvider,
    modelsByTier: { cheap: 'fixture-model', frontier: 'fixture-model' },
    pricing: {},
  });

  // Real agent: prompt → gateway (Fake) → parse → groundPlanSet / decideReplan.
  // Structurally compatible with the evals' PlannerAgent surface.
  return new LlmStrategicPlannerAgent(gateway);
}

// Re-export for callers that only import the fixture.
export type { PlannerInput };