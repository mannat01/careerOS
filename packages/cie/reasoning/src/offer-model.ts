/**
 * Offer-Comparison domain types — the OFFER COMPARISON shape the CIE returns
 * for "which offer is best given my real values?"-style questions
 * (docs/milestone-05.md §Stage-5 offer comparison; PRD §7 A1.3).
 *
 * A comparison is NEVER a bare "pick this one". It carries: the objective
 * multi-factor ranking (offer ids, most-preferred first), the weights echoed
 * from the user's REAL stated preferences (no invented keys), a per-factor
 * explanation that cites REAL offer attributes only, and offer-id evidence
 * refs. Model stamp makes every comparison reproducible + audit-able
 * (CLAUDE.md §3.5).
 *
 * Types mirror `evals/src/types.ts` OfferComparison 1:1 so the golden gate
 * drives the real agent directly and structurally matches the
 * /v1/cie/decide/offers response body.
 */

export const OFFER_COMPARISON_MODEL_VERSION = 'offer-comparison@1.0.0';

/** One candidate offer (input surface — real attributes only). */
export interface CandidateOffer {
  id: string;
  title: string;
  company: string;
  /** Free-text attribute values keyed by user's value name (e.g. 'remote work'). */
  attributes: Record<string, string>;
}

/** The user's REAL stated values + weights (weights must sum to 1). */
export interface CandidateValues {
  goals: string[];
  values: string[];
  weights: Record<string, number>;
}

/**
 * The grounded offer comparison. `weights` echoes the user's REAL stated
 * weights (never derived from the LLM's proposal). `evidenceRefs` are the
 * offer ids the ranking used — never phantom refs.
 */
export interface OfferComparison {
  ranking: string[];
  weights: Record<string, number>;
  explanation: string;
  evidenceRefs: string[];
  /** Model + prompt version stamp — identical inputs + version → identical output. */
  modelVersion?: string;
}