/**
 * Strategy-Planner skill-agent — profile + state model + STATED goals + career
 * graph (+ optional research) → a grounded, laddered, justified 30d/90d/1y/3y/5y
 * plan set, plus §4A-correct adaptivity on replan.
 *
 * Pipeline (same shape as the M05 reasoner — coding-standards §7):
 *   1. Build system + user prompt (prompt.ts) from the inputs.
 *   2. Call the llm-gateway FRONTIER tier — strategic planning is not a cheap
 *      classify (CLAUDE.md §3.6).
 *   3. Parse JSON with Zod (io.ts `rawPlanProposalSchema`) — fail-closed on garbage.
 *   4. DETERMINISTIC guardrail (io.ts `groundPlanSet`) — the model's proposal is
 *      IGNORED and the plan set is recomputed from the REAL goals/graph/gaps.
 *      This step — not the prompt — makes the planner golden eval green and
 *      defeats each fabrication probe (invented goal, ungrounded action,
 *      out-of-plan today's move).
 *   5. On replan, `decideReplan` regenerates ONLY on a §4A material change (with
 *      an explained diff) and holds steady on sub-threshold changes (no thrash).
 *
 * The agent NEVER imports @careeros/db: it receives facts/state/goals/graph that
 * the caller assembled via Memory/Graph/State ports (agentBoundary lint overlay).
 */
import type { LlmGateway } from '@careeros/llm-gateway';
import {
  STRATEGIC_PLANNER_SYSTEM_PROMPT,
  buildStrategicPlannerUserPrompt,
} from './prompt.js';
import {
  decideReplan,
  groundPlanSet,
  rawPlanProposalSchema,
} from './io.js';
import type {
  PlanChangeEvent,
  PlannerInput,
  ReplanResult,
  StrategyPlanSet,
} from './model.js';

/** Structurally matches evals/src/types.ts `PlannerAgent` (kept decoupled). */
export interface PlannerAgent {
  plan(input: PlannerInput): Promise<StrategyPlanSet>;
  replan(input: PlannerInput, prior: StrategyPlanSet, change: PlanChangeEvent): Promise<ReplanResult>;
}

const EMPTY_PROPOSAL = {
  plans: [],
  todaysMove: { actionId: '', justification: '' },
};

export class LlmStrategicPlannerAgent implements PlannerAgent {
  constructor(private readonly gateway: LlmGateway) {}

  async plan(input: PlannerInput): Promise<StrategyPlanSet> {
    const proposal = await this.propose(input);
    // The proposal is DISCARDED: the plan set is recomputed from real inputs.
    return groundPlanSet(proposal, input);
  }

  async replan(
    input: PlannerInput,
    _prior: StrategyPlanSet,
    change: PlanChangeEvent,
  ): Promise<ReplanResult> {
    // §4A single source of truth decides regeneration; sub-threshold ⇒ hold.
    // We only pay for the LLM call when the change is material.
    const proposal = await this.propose(input);
    return decideReplan(proposal, input, change);
  }

  /** Call the frontier LLM and parse (fail-closed). Proposal is advisory only. */
  private async propose(input: PlannerInput) {
    const messages = [
      { role: 'system' as const, content: STRATEGIC_PLANNER_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: buildStrategicPlannerUserPrompt(
          input.profile,
          input.stateModel,
          input.goals,
          input.graph,
          input.gaps,
          input.research,
        ),
      },
    ];

    // Frontier tier: multi-horizon strategy is reasoning, not a cheap classify.
    const response = await this.gateway.complete({
      tier: 'frontier',
      messages,
      maxTokens: 4096,
      temperature: 0,
    });

    const parsed = rawPlanProposalSchema.safeParse(safeJsonParse(response.text));
    // Fail-closed: malformed output → empty proposal. The guardrail recomputes
    // from real inputs anyway, so bad JSON is structurally "no proposal".
    return parsed.success ? parsed.data : EMPTY_PROPOSAL;
  }
}

/** JSON.parse that returns null instead of throwing (fail-closed boundary). */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}