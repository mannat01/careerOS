/**
 * GapAnalyzer domain types — M09 Step 3 (database-schema.md §cie: Profile 1:N
 * SkillGap 1:N LearningItem).
 *
 * A SkillGap is a DEMANDED-BUT-MISSING skill, computed DETERMINISTICALLY:
 *   - `per_opp`  — a real opportunity's required skill the profile does not
 *     demonstrate, surfaced by a low match subscore for that opportunity;
 *   - `aggregate` — a low-confidence/absent state-model dimension measured
 *     against the user's STATED target roles.
 *
 * Discipline (same pattern as the M08 metric composer):
 *   - the gap SET and every skill IDENTITY are computed deterministically
 *     from real inputs. An LLM (if used at all) only DRAFTS the wording of
 *     "why this gap matters"; the wording is validated against the computed
 *     gap and DISCARDED (deterministic fallback substituted) if it lies.
 *   - never a gap for a skill the user already demonstrates (checked against
 *     the state model's demonstrated_skills dimension);
 *   - every LearningItem links to a real SkillGap.
 */

/** Stamped on every gap set produced — reproducibility (CLAUDE.md §3.5). */
export const GAP_ANALYZER_MODEL_VERSION = 'gap-analyzer@1.0.0';

/** A match subscore below this value flags the opportunity as gap-bearing. */
export const SUBSCORE_GAP_THRESHOLD = 70;

/** A state dimension at/below this confidence is a low-confidence signal. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * The state-model dimensions the aggregate pass inspects. Readiness-bearing
 * dimensions only — a weak compensation_goals dimension is not a skill gap.
 */
export const AGGREGATE_GAP_DIMENSIONS = [
  'demonstrated_skills',
  'leadership_readiness',
  'communication_style',
  'learning_velocity',
] as const;

// ---------- inputs ----------

/** One real (profile, opportunity) match signal — the per-opp gap source. */
export interface GapMatchSignal {
  opportunityId: string;
  /** Company + role label for grounded wording ("demanded by Acme — SRE"). */
  opportunityLabel: string;
  /** The scorer's subscores for this pair (key + 0-100 value). */
  subscores: Array<{ key: string; value: number }>;
  /** The opportunity's REAL parsed required skills (the demanded universe). */
  requiredSkills: string[];
}

/** One derived state-model dimension — the demonstrated-skill + aggregate source. */
export interface GapStateDimension {
  dimension: string;
  values: string[];
  confidence: number;
}

/** The analyzer's full input surface. Reached via ports; never @careeros/db. */
export interface GapAnalyzerInput {
  matches: GapMatchSignal[];
  stateModel: GapStateDimension[];
  /** The user's STATED target roles (profiles.target_roles). */
  targetRoles: string[];
}

// ---------- outputs ----------

export type SkillGapSource = 'per_opp' | 'aggregate';
export type SkillGapSeverity = 'low' | 'medium' | 'high';

/** One computed gap (maps 1:1 onto the skill_gaps row). */
export interface ComputedSkillGap {
  /** Stable per-computation key: `<source>:<skill>[:<opportunityId>]`. */
  key: string;
  /** Canonical (lowercased, trimmed) skill identity. */
  skill: string;
  source: SkillGapSource;
  /** Set iff source='per_opp' — the REAL opportunity the demand came from. */
  opportunityId?: string;
  /** Grounded "why this is a gap" wording (deterministic or validated draft). */
  gap: string;
  severity: SkillGapSeverity;
  /** What the derivation leaned on (subscore keys, dimension names, roles). */
  evidenceRefs: string[];
}

/** One learning recommendation — always linked to a real computed gap. */
export interface ComputedLearningItem {
  /** The `key` of the ComputedSkillGap this item closes. Must resolve. */
  gapKey: string;
  resource: { title: string; kind: 'course' | 'project' | 'practice'; effort: string };
}

/** The analyzer's full output: gaps + recommendations, integrity-checked. */
export interface GapAnalysis {
  modelVersion: string;
  gaps: ComputedSkillGap[];
  learningItems: ComputedLearningItem[];
}

// ---------- guardrail ----------

export type GapViolationCode =
  | 'invented_gap'
  | 'already_demonstrated'
  | 'unknown_opportunity'
  | 'unlinked_learning_item';

export interface GapViolation {
  code: GapViolationCode;
  subject: string;
  detail: string;
}