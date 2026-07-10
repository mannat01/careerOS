/**
 * Golden-dataset types for the M02 eval gates (extraction + state model).
 * These types define THE BAR the real agents must meet — they are authored
 * before any agent code exists (workorder Task 0).
 */

// ---------- provenance ----------

/** Every expected fact must be traceable to an exact quote in the source text. */
export interface Provenance {
  source: 'resume';
  /** Exact substring of the resume text that evidences this fact. */
  quote: string;
}

// ---------- extraction (resume text → structured entities) ----------

export interface ExpectedExperience {
  kind: 'experience';
  company: string;
  title: string;
  /** YYYY-MM when derivable from the text; omit when the resume omits it. */
  start?: string;
  /** YYYY-MM, or 'present' for a current role. (string & {}) keeps the literal from being absorbed. */
  end?: (string & {}) | 'present';
  provenance: Provenance;
}

export interface ExpectedProject {
  kind: 'project';
  name: string;
  skills?: string[];
  provenance: Provenance;
}

export interface ExpectedEducation {
  kind: 'education';
  institution: string;
  credential?: string;
  field?: string;
  provenance: Provenance;
}

/**
 * `evidence` distinguishes how the skill is supported by the text:
 * - demonstrated: tied to concrete work described in the resume
 * - claimed: merely listed/self-asserted (a weaker signal downstream)
 */
export interface ExpectedSkill {
  kind: 'skill';
  name: string;
  evidence: 'demonstrated' | 'claimed';
  provenance: Provenance;
}

export type ExpectedEntity = ExpectedExperience | ExpectedProject | ExpectedEducation | ExpectedSkill;

export type ResumeFormat =
  | 'chronological'
  | 'functional'
  | 'bullet-heavy'
  | 'sparse'
  | 'career-changer'
  | 'non-linear'
  | 'adversarial';

export interface ExtractionCase {
  id: string;
  format: ResumeFormat;
  resumeText: string;
  /** Entities a correct extractor MUST produce (recall is measured over these). */
  expected: ExpectedEntity[];
  /**
   * ZERO-FABRICATION guard: strings that must NEVER appear anywhere in the
   * extracted output. Populated on adversarial cases where vague phrasing
   * baits a weak model into inflating it into a credential/title/skill.
   */
  forbidden?: string[];
  /** Human note describing the embellishment trap (adversarial cases only). */
  trap?: string;
}

// ---------- extraction agent surface (what Step 2 must implement) ----------

export interface ExtractedEntity {
  kind: 'experience' | 'project' | 'education' | 'skill';
  /** Primary name: company, project name, institution, or skill name. */
  name: string;
  /** Secondary field: title / credential / evidence tier, kind-dependent. */
  detail?: string;
  provenance?: Provenance;
}

export interface ExtractionAgent {
  extract(resumeText: string): Promise<ExtractedEntity[]>;
}

// ---------- state model (parsed profile → dimensions) ----------

/** A structured profile as it would exist AFTER extraction (input to the state agent). */
export interface ProfileFact {
  id: string;
  kind: 'experience' | 'project' | 'education' | 'skill';
  summary: string;
}

export interface StateModelCase {
  id: string;
  description: string;
  profile: ProfileFact[];
  expected: ExpectedDimension[];
  /** Values that must NOT be asserted anywhere (fabrication / inflation guard). */
  forbidden?: string[];
}

export interface ExpectedDimension {
  /** A1.1 dimension key, e.g. 'demonstrated_skills', 'inferred_skills', 'strengths'. */
  dimension: string;
  /** Values the derived dimension must include. */
  mustInclude: string[];
  /** Values the derived dimension must NOT include (e.g. inferred listed as demonstrated). */
  mustNotInclude?: string[];
  /** Acceptable confidence band for this dimension on this profile. */
  confidence: { min: number; max: number };
  /** Profile fact ids the dimension MUST cite as evidence. */
  evidenceRefs: string[];
}

export interface DerivedDimension {
  dimension: string;
  values: string[];
  confidence: number;
  evidenceRefs: string[];
}

export interface StateModelAgent {
  derive(profile: ProfileFact[]): Promise<DerivedDimension[]>;
}
