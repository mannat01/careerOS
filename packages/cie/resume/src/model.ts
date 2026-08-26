/**
 * Resume-intelligence domain types (database-schema.md §resume —
 * `ResumeModel` + `ResumeVariant`).
 *
 * A `ResumeModel` is a STRUCTURED resume, not a file: an ordered selection of
 * real profile facts (experience/project/skill/education ids) with optional
 * phrasing overrides. The `base` model is derived straight from the profile
 * (every fact, source order). A `ResumeVariant` is a tailored, job-bound
 * derivative: a selected/ordered/rephrased subset, each rendered claim traceable
 * to a real source `factId`, with a stored `diff` (vs base), a `rationale`, an
 * `atsCheck`, and a `modelVersion` stamp (explainable + reproducible — CLAUDE.md
 * §3.5). The binary PDF/DOCX export is a separate render step (STUB(M03)); the
 * eval + ATS-check operate on the ATS-safe plain-text form.
 */
import type {
  ResumeAtsCheck as AtsCheck,
  ResumeDiff,
  ResumeModel,
  ResumeSelectedItem as SelectedItem,
  ResumeTailoredBullet as TailoredBullet,
  ResumeVariant,
} from '@careeros/contracts';

export const RESUME_MODEL_VERSION = 'tailor@1.0.0';

/** Version stamp for the match scorer/explainer — deterministic + reproducible. */
export const MATCH_SCORER_MODEL_VERSION = 'match-scorer@1.0.0';

/**
 * A structured profile fact as it exists AFTER extraction — the Tailor's input
 * surface. Mirrors the evals' `ProfileFact` and memory's projection 1:1 so the
 * golden gate can drive the real agent directly.
 */
export interface TailorProfileFact {
  id: string;
  kind: 'experience' | 'project' | 'education' | 'skill';
  summary: string;
}

/** A parsed job description — the tailoring input alongside the profile. */
export interface JobDescription {
  title: string;
  /** e.g. 'junior' | 'mid' | 'senior' | 'staff' when the JD states one. */
  seniority?: string;
  /** The job's STATED requirements — relevance is measured against these. */
  requirements: string[];
  /** Full JD text (untrusted source; sanitize before it reaches an LLM). */
  text: string;
}

/** Public résumé wire types are inferred from strict @careeros/contracts schemas. */
export type { AtsCheck, ResumeDiff, ResumeModel, SelectedItem, TailoredBullet, ResumeVariant };

/**
 * One rendered bullet in a tailored variant. `factId` is its STRUCTURAL
 * provenance — the real `TailorProfileFact` it traces to (the tailoring analogue
 * of the extraction provenance quote). A bullet whose `factId` does not resolve,
 * or whose `text` introduces claims not grounded in that fact, is a fabrication
 * and is dropped by the guardrail.
 */

/**
 * The Tailor agent's OUTPUT for a (profile, job) pair. Structurally matches
 * `evals/src/types.ts` `TailoredResume` so the golden gate consumes it directly.
 */
export interface TailoredResume {
  bullets: TailoredBullet[];
  /** ATS-safe plain-text rendering of the variant (what the renderer emits). */
  rendered: string;
}


/**
 * One facet of a match score (0–100). The scorer always exposes the demanded
 * facets — skills/experience/seniority/domain/comp/location/trajectory — so a
 * score is a decomposition, never a bare number.
 */
export interface MatchSubscore {
  /** e.g. 'skills_match' | 'seniority_fit' | 'domain_fit'. */
  key: string;
  /** 0–100. */
  value: number;
}

/**
 * The Scorer/Explainer's OUTPUT for a (profile, job) pair is a DISCRIMINATED
 * UNION on `status` (structurally matches `evals/src/types.ts` `MatchScore` so
 * the golden gate consumes it directly):
 *
 *   - `status: 'ok'`               — a grounded rubric score (overall + subscores
 *                                    + explanation + evidenceRefs). This is the
 *                                    honest fit even when it is LOW: a clearly-bad
 *                                    but ASSESSABLE fit (barista → backend) is a
 *                                    low `ok`, never `insufficient_data`.
 *   - `status: 'insufficient_data'`— the profile carries too little relevant
 *                                    evidence to assess the JD's requirements AT
 *                                    ALL. We refuse to invent a number and say so.
 *
 * There is deliberately NO continuous confidence field: a fit score is a grounded
 * rubric, not a probability.
 *
 * INTEGRITY INVARIANTS (enforced deterministically in io.ts, not by the prompt):
 *  - `overall` reflects REAL requirement coverage — a demanded-but-missing skill
 *    lowers the relevant subscore and is named in the explanation, never papered
 *    over;
 *  - `explanation` is plain-language and GROUNDED — it may cite only real
 *    evidence (`evidenceRefs` are real profile fact ids), never a claimed match
 *    on a skill the candidate lacks;
 *  - a score NEVER travels without its explanation (never a bare number);
 *  - a thin/unassessable profile yields `insufficient_data`, never a fabricated
 *    score.
 */
export type MatchScoreStatus = 'ok' | 'insufficient_data';

/** The grounded-rubric arm: a real, explained fit (possibly a low but honest one). */
export interface MatchScoreOk {
  status: 'ok';
  /** 0–100 overall match. */
  overall: number;
  /** Always includes the demanded facets — a score is never a bare number. */
  subscores: MatchSubscore[];
  /** Plain-language explanation — never a bare number (M03 acceptance). */
  explanation: string;
  /** Real profile fact ids the explanation grounds itself in (provenance). */
  evidenceRefs: string[];
  /** Version stamp — identical inputs + version → identical score. */
  modelVersion?: string;
}

/** The honest-refusal arm: not enough profile evidence to assess this role's fit. */
export interface MatchScoreInsufficient {
  status: 'insufficient_data';
  /** Plain-language reason the fit could not be assessed (never a bare status). */
  reason: string;
  /** Version stamp — identical inputs + version → identical verdict. */
  modelVersion?: string;
}

export type MatchScore = MatchScoreOk | MatchScoreInsufficient;
