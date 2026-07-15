/**
 * Strategic-Reasoner domain types — the DECISION CONTRACT shape the CIE returns
 * for "should I apply/wait/negotiate?"-style questions (docs/milestone-05.md
 * §Objectives, PRD §7 A1.3).
 *
 * A decision is NEVER a bare verdict. It carries: alternatives considered,
 * evidence refs traceable to real profile/graph/state facts, transparent
 * reasoning, a CALIBRATED confidence in [0,1], the reasoner's assumptions, the
 * recommendation, and an optionality note. The model stamp makes every
 * recommendation reproducible + audit-able (CLAUDE.md §3.5).
 *
 * Types mirror `evals/src/types.ts` DecisionContract 1:1 so the golden gate can
 * drive the real agent directly, and structurally match the /v1/cie/decide
 * response body.
 */

export const STRATEGIC_REASONER_MODEL_VERSION = 'strategic-reasoner@1.0.0';

/** Profile fact — Reasoner input surface (matches evals + memory projection). */
export interface ReasonerProfileFact {
  id: string;
  kind: 'experience' | 'project' | 'education' | 'skill';
  summary: string;
}

/** One derived Career State Model dimension (from @careeros/cie-state). */
export interface ReasonerStateDimension {
  dimension: string;
  values: string[];
  confidence: number;
  evidenceRefs: string[];
}

/** Opportunity / job attached to the question (may be undefined for pure state queries). */
export interface ReasonerOpportunity {
  title: string;
  seniority?: string;
  requirements: string[];
  text: string;
}

/**
 * The structured decision contract. Every claim in `reasoning` must be
 * supported by an `evidenceRef` that resolves to a real profile/state fact.
 * `confidence` is calibrated by the deterministic guardrail from evidence
 * strength — NOT trusted from the LLM proposal.
 */
export interface DecisionContract {
  alternatives: string[];
  evidenceRefs: string[];
  reasoning: string;
  confidence: number;
  assumptions: string[];
  recommendation: string;
  optionalityNote?: string;
  /** Model + prompt version stamp — identical inputs + version → identical contract. */
  modelVersion?: string;
}

/** The three canonical alternatives every apply/wait/negotiate decision considers. */
export const CANONICAL_ALTERNATIVES = ['apply', 'wait', 'negotiate'] as const;
