/**
 * Strategic-Reasoner skill-agent — profile + state model + a decision question
 * (optionally attached to an opportunity) → a grounded, honest, calibrated
 * DecisionContract.
 *
 * Pipeline (same shape as the M03 tailor/scorer — coding-standards §7):
 *   1. Build system + user prompt (prompt.ts) from the inputs.
 *   2. Call the llm-gateway FRONTIER tier — strategic reasoning is not a cheap
 *      classify (CLAUDE.md §3.6).
 *   3. Parse JSON with Zod (io.ts `rawDecisionProposalSchema`) — fail-closed on
 *      garbage.
 *   4. DETERMINISTIC guardrail (io.ts `groundContract`) — the model's proposal
 *      is IGNORED and the contract is recomputed from the REAL profile/state/
 *      opportunity. This step — not the prompt — is what makes the decision
 *      golden eval green and defeats each fabrication probe.
 *
 * The agent NEVER imports @careeros/db: it receives facts/state that the caller
 * assembled via MemoryService/state-service ports (agentBoundary lint overlay).
 */
import type { LlmGateway } from '@careeros/llm-gateway';
import {
  STRATEGIC_REASONER_SYSTEM_PROMPT,
  buildStrategicReasonerUserPrompt,
} from './prompt.js';
import { groundContract, rawDecisionProposalSchema } from './io.js';
import type {
  DecisionContract,
  ReasonerOpportunity,
  ReasonerProfileFact,
  ReasonerStateDimension,
} from './model.js';

/** Structurally matches evals/src/types.ts `DecisionAgent` (kept decoupled). */
export interface DecisionAgent {
  decide(
    profile: ReasonerProfileFact[],
    stateModel: ReasonerStateDimension[],
    opportunity: ReasonerOpportunity | undefined,
    question: string,
  ): Promise<DecisionContract>;
}

export class LlmStrategicReasonerAgent implements DecisionAgent {
  constructor(private readonly gateway: LlmGateway) {}

  async decide(
    profile: ReasonerProfileFact[],
    stateModel: ReasonerStateDimension[],
    opportunity: ReasonerOpportunity | undefined,
    question: string,
  ): Promise<DecisionContract> {
    const messages = [
      { role: 'system' as const, content: STRATEGIC_REASONER_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: buildStrategicReasonerUserPrompt(profile, stateModel, opportunity, question),
      },
    ];

    // Frontier tier: apply/wait/negotiate is strategic reasoning per CLAUDE.md §3.6.
    const response = await this.gateway.complete({
      tier: 'frontier',
      messages,
      maxTokens: 2048,
      temperature: 0,
    });

    const parsed = rawDecisionProposalSchema.safeParse(safeJsonParse(response.text));
    // Fail-closed: malformed output → the guardrail still recomputes from real
    // inputs (it ignores the proposal's numbers anyway), so a bad JSON is
    // structurally equivalent to "no proposal".
    const proposal = parsed.success
      ? parsed.data
      : {
          alternatives: [],
          evidenceRefs: [],
          reasoning: '',
          confidence: 0,
          assumptions: [],
          recommendation: '',
        };

    return groundContract(proposal, profile, stateModel, opportunity, question);
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
