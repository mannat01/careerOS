/**
 * Offer-Comparison skill-agent — candidate values/goals (with weights) + 2-3
 * candidate offers → a grounded, objective, user-anchored OfferComparison.
 *
 * Pipeline (same shape as the strategic-reasoner / M03 tailor+scorer —
 * coding-standards §7):
 *   1. Build system + user prompt (offer-prompt.ts) from the inputs.
 *   2. Call the llm-gateway FRONTIER tier — offer trade-off reasoning is
 *      strategic (CLAUDE.md §3.6), not a cheap classify.
 *   3. Parse JSON with Zod (offer-io.ts `rawOfferComparisonProposalSchema`) —
 *      fail-closed on garbage.
 *   4. DETERMINISTIC guardrail (offer-io.ts `groundOfferComparison`) — the
 *      model's proposal is IGNORED and the ranking/weights/explanation are
 *      recomputed from the REAL offers + REAL user weights. This step — not
 *      the prompt — is what makes the offers golden eval green and defeats
 *      each fabrication probe (invented perk / invented weight key /
 *      phantom evidence ref).
 *
 * The agent NEVER imports @careeros/db: it receives values/offers directly
 * from the caller (per-user by construction at the endpoint layer).
 */
import type { LlmGateway } from '@careeros/llm-gateway';
import {
  OFFER_COMPARISON_SYSTEM_PROMPT,
  buildOfferComparisonUserPrompt,
} from './offer-prompt.js';
import {
  groundOfferComparison,
  rawOfferComparisonProposalSchema,
} from './offer-io.js';
import type {
  CandidateOffer,
  CandidateValues,
  OfferComparison,
} from './offer-model.js';

/** Structurally matches evals/src/types.ts `OfferComparisonAgent` (kept decoupled). */
export interface OfferComparisonAgent {
  compare(values: CandidateValues, offers: CandidateOffer[]): Promise<OfferComparison>;
}

export class LlmOfferComparisonAgent implements OfferComparisonAgent {
  constructor(private readonly gateway: LlmGateway) {}

  async compare(
    values: CandidateValues,
    offers: CandidateOffer[],
  ): Promise<OfferComparison> {
    const messages = [
      { role: 'system' as const, content: OFFER_COMPARISON_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: buildOfferComparisonUserPrompt(values, offers),
      },
    ];

    // Frontier tier: multi-factor offer trade-offs are strategic reasoning per CLAUDE.md §3.6.
    const response = await this.gateway.complete({
      tier: 'frontier',
      messages,
      maxTokens: 2048,
      temperature: 0,
    });

    const parsed = rawOfferComparisonProposalSchema.safeParse(safeJsonParse(response.text));
    // Fail-closed: malformed output → the guardrail still recomputes from real
    // inputs (it ignores the proposal anyway), so a bad JSON is structurally
    // equivalent to "no proposal".
    const proposal = parsed.success
      ? parsed.data
      : {
          ranking: [],
          weights: {},
          explanation: '',
          evidenceRefs: [],
        };

    return groundOfferComparison(proposal, values, offers);
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