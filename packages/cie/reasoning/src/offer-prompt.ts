/**
 * Offer-Comparison prompt — instructs the FRONTIER tier (strategic reasoning —
 * CLAUDE.md §3.6) to weigh a candidate's REAL stated values/goals against 2–3
 * candidate offers and propose a ranked structured comparison.
 *
 * IMPORTANT: the prompt ASKS for honesty, but the deterministic guardrail in
 * offer-io.ts (`groundOfferComparison`) is what ENFORCES it. Prompt wording is
 * advisory; a real model (and our "pressure-to-fabricate" FakeLlmProvider)
 * will still occasionally invent a perk not present in the offer, add a weight
 * for a preference the user never stated, or cite an offer id that does not
 * exist. The prompt is versioned — changing it requires `offer-agent.eval.ts`
 * to pass.
 */
import type { CandidateOffer, CandidateValues } from './offer-model.js';

export const OFFER_COMPARISON_PROMPT_VERSION = '1.0.0';

export const OFFER_COMPARISON_SYSTEM_PROMPT = `You are an offer-comparison reasoner. Given a candidate's REAL stated values/goals with weights, and 2-3 candidate offers each with attributes keyed by those value names, propose an OBJECTIVE multi-factor ranking.

Return:
- ranking: offer ids in preference order (most-preferred first)
- weights: echo the user's exact stated weights (same keys, same numbers, no additions)
- explanation: short plain-language rationale that references the ranking's factors
- evidenceRefs: the real offer ids the ranking uses (never a phantom id)

HARD RULES (the system enforces these deterministically; do not attempt to evade them):
- Use ONLY the user's REAL stated values + weights. Never add a new weight key for a preference the user never stated. Never rescale the user's numbers.
- Every factor's assessment must cite REAL offer attribute data. Never invent a perk (e.g. "remote option" where the offer states none) or a benefit not present in the attributes.
- Every evidenceRef MUST be one of the real offer ids passed in. No phantom ids.
- The explanation must be present and non-empty.

Return ONLY a JSON object: { "ranking": ["o2","o1"], "weights": {"remote work":0.5, ...}, "explanation": "...", "evidenceRefs": ["o1","o2"] }. No markdown, no explanation prose outside the JSON.`;

export function buildOfferComparisonUserPrompt(
  values: CandidateValues,
  offers: CandidateOffer[],
): string {
  const weightLines = Object.entries(values.weights)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const goalLines = values.goals.map((g) => `- ${g}`).join('\n');
  const offerBlocks = offers
    .map((o) => {
      const attrs = Object.entries(o.attributes)
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join('\n');
      return `[${o.id}] ${o.title} @ ${o.company}\n${attrs}`;
    })
    .join('\n\n');
  return `USER GOALS:
${goalLines}

USER VALUES + WEIGHTS (echo these EXACTLY, do not invent keys):
${weightLines}

CANDIDATE OFFERS (each attribute keyed by a user value):
${offerBlocks}

Propose the structured offer comparison. Cite offer ids on every claim; do not invent perks or preferences.`;
}