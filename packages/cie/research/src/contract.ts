import type {
  ResearchSynthesis as GroundedResearchSynthesis,
  ResearchSynthesisInput,
} from './model.js';

/**
 * Explicit sufficiency threshold for research synthesis.
 *
 * Synthesis is possible when at least one provided finding:
 *  - has a non-empty claim; and
 *  - names a source present in the caller-provided sanctioned allow-list.
 *
 * One weak sanctioned finding is sufficient. Relevance is deliberately not
 * part of this threshold: sourced content that is honest but unrelated to the
 * user's current context remains an `ok` synthesis with zero insights after the
 * authoritative grounding/personalization pass.
 */
export function hasSufficientSanctionedResearchContent(
  input: ResearchSynthesisInput,
): boolean {
  const allowedSources = new Set(input.allowedSources);
  return input.findings.some(
    (finding) =>
      finding.claim.trim().length > 0 && allowedSources.has(finding.sourceId),
  );
}

export const RESEARCH_INSUFFICIENT_DATA_REASON =
  'No sanctioned research finding with non-empty source content was provided.';

/** Successful, fully grounded synthesis. */
export type ResearchSynthesisOk = GroundedResearchSynthesis & {
  status: 'ok';
};

/** Honest refusal: no model-derived fields can appear on this arm. */
export interface ResearchSynthesisInsufficientData {
  status: 'insufficient_data';
  reason: string;
}

/** Public research result contract. Callers must handle both arms. */
export type ResearchSynthesis =
  | ResearchSynthesisOk
  | ResearchSynthesisInsufficientData;