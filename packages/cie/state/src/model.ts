/**
 * Career State Model domain types (database-schema.md §cie —
 * `CareerStateModel` + `CareerStateDimension`).
 *
 * A `CareerStateModel` is the versioned header; it owns one
 * `CareerStateDimension` row per A1.1 dimension. Every dimension carries the
 * four CIE invariants: a `value` (the derived labels), a `confidence` in [0,1],
 * a `provenance` string, and `evidenceRefs` that resolve to graph nodes /
 * profile facts (so a dimension is always explainable + calibratable). History
 * is retained out-of-band via `MemoryEvent` (why a dimension moved).
 *
 * The dimension VOCABULARY below is the A1.1 set the StateUpdater derives. It is
 * the source of truth the agent scaffolds from, so a state model ALWAYS presents
 * ≥12 dimensions (empty where the profile gives no signal — an empty comp/geo
 * dimension is a first-class "no signal", never a fabricated guess).
 */

/** The A1.1 dimension keys the StateUpdater derives (≥12). */
export const CANONICAL_DIMENSIONS = [
  'career_goals',
  'interests',
  'strengths',
  'weaknesses',
  'demonstrated_skills',
  'inferred_skills',
  'learning_velocity',
  'preferred_industries',
  'preferred_company_sizes',
  'compensation_goals',
  'geographic_preferences',
  'work_style_preferences',
  'values',
  'leadership_readiness',
  'communication_style',
] as const;

export type DimensionKey = (typeof CANONICAL_DIMENSIONS)[number];

/**
 * Dimensions whose values are only legitimate when a REAL preference/goal signal
 * grounds them. A state license is not a location preference; business revenue is
 * not a compensation goal — so these stay empty unless a fact expresses intent.
 */
export const NO_SIGNAL_DIMENSIONS: readonly DimensionKey[] = [
  'compensation_goals',
  'geographic_preferences',
  'preferred_company_sizes',
];

export const MODEL_VERSION = 'state-updater@1.0.0';

/**
 * A structured profile fact as it exists AFTER extraction — the StateUpdater's
 * input surface. Mirrors the evals' `ProfileFact` 1:1 so the golden gate can
 * drive the real agent directly.
 */
export interface StateProfileFact {
  id: string;
  kind: 'experience' | 'project' | 'education' | 'skill';
  summary: string;
}

/**
 * The eval-facing projection of one derived dimension: the labels, the aggregate
 * confidence, and the union of evidence refs. Structurally matches
 * `evals/src/types.ts` `DerivedDimension`.
 */
export interface DerivedDimension {
  dimension: string;
  values: string[];
  confidence: number;
  evidenceRefs: string[];
}

/**
 * One persisted `CareerStateDimension` row (database-schema.md §cie). Richer than
 * `DerivedDimension`: carries provenance + freshness + model version for the
 * explain endpoint and calibration.
 */
export interface CareerStateDimension {
  dimension: DimensionKey;
  /** jsonb in the schema; the derived labels for this dimension. */
  value: { values: string[] };
  confidence: number;
  provenance: string;
  /** jsonb → graph node / profile fact ids. */
  evidenceRefs: string[];
  freshnessAt: string;
  modelVersion: string;
}

/** The versioned model header + its dimension rows. */
export interface CareerStateModel {
  profileId: string;
  version: number;
  updatedAt: string;
  dimensions: CareerStateDimension[];
}

/** Project a persisted dimension row down to the eval-facing shape. */
export function toDerived(d: CareerStateDimension): DerivedDimension {
  return {
    dimension: d.dimension,
    values: d.value.values,
    confidence: d.confidence,
    evidenceRefs: d.evidenceRefs,
  };
}
