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

export const RESUME_MODEL_VERSION = 'tailor@1.0.0';

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

/**
 * One rendered bullet in a tailored variant. `factId` is its STRUCTURAL
 * provenance — the real `TailorProfileFact` it traces to (the tailoring analogue
 * of the extraction provenance quote). A bullet whose `factId` does not resolve,
 * or whose `text` introduces claims not grounded in that fact, is a fabrication
 * and is dropped by the guardrail.
 */
export interface TailoredBullet {
  text: string;
  factId: string;
}

/**
 * The Tailor agent's OUTPUT for a (profile, job) pair. Structurally matches
 * `evals/src/types.ts` `TailoredResume` so the golden gate consumes it directly.
 */
export interface TailoredResume {
  bullets: TailoredBullet[];
  /** ATS-safe plain-text rendering of the variant (what the renderer emits). */
  rendered: string;
}

/** ATS parse-safety verdict on a rendered variant. */
export interface AtsCheck {
  passed: boolean;
  warnings: string[];
}

/** One ordered, optionally-rephrased fact reference inside a ResumeModel. */
export interface SelectedItem {
  factId: string;
  order: number;
  /** A grounded rephrasing of the fact's summary; absent = use the summary verbatim. */
  phrasing?: string;
}

/** The structured resume (database-schema.md §resume ResumeModel). */
export interface ResumeModel {
  id: string;
  profileId: string;
  name: string;
  /** Ordered fact ids + phrasing overrides. */
  selectedItems: SelectedItem[];
  /** True for the profile-derived base model; variants derive from it. */
  base: boolean;
}

/**
 * The stored `diff` of a variant vs its base model (database-schema.md jsonb):
 * which facts survived, which were dropped as off-target, which were rephrased.
 */
export interface ResumeDiff {
  /** Fact ids selected into the variant, in render order. */
  selected: string[];
  /** Fact ids present in the base but dropped from the variant (off-target). */
  dropped: string[];
  /** Facts whose rendered text differs from the source summary (a rephrasing). */
  rephrased: Array<{ factId: string; from: string; to: string }>;
}

/** The tailored, job-bound variant (database-schema.md §resume ResumeVariant). */
export interface ResumeVariant {
  id: string;
  resumeModelId: string;
  /** Bound opportunity/job id, or null for an unbound draft. */
  opportunityId: string | null;
  bullets: TailoredBullet[];
  /** ATS-safe plain-text render (the render_artifact is a STUB(M03) binary step). */
  rendered: string;
  diff: ResumeDiff;
  rationale: string;
  atsCheck: AtsCheck;
  modelVersion: string;
}
