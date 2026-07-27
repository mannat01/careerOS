/**
 * M10 Step 2 — Cross-user Market Intelligence (opt-in, de-identified, aggregated).
 *
 * PRIVACY-CRITICAL DOMAIN MODEL. Every type here is designed so that a
 * cross-user data leak is structurally hard, not merely discouraged:
 *
 *   1. A {@link RawContribution} carries the contributing `userId` ONLY so the
 *      pipeline can (a) gate on that user's opt-in and (b) purge their prior
 *      contribution on opt-out. The `userId` NEVER appears on any
 *      {@link MarketAggregate} — the aggregate output type has no field capable
 *      of holding it.
 *   2. Every aggregate is gated by a minimum-cohort threshold (k-anonymity
 *      style): nothing is emitted for a cohort smaller than N distinct
 *      contributors. A single-contributor "aggregate" would be a re-identifiable
 *      passthrough of one user's data, so it is suppressed.
 *   3. Only contributions from users who explicitly opted in
 *      (`UserSettings.data_use_optins.cross_user_intel === true`) ever reach the
 *      aggregator. Opt-in is checked at contribution time via the narrow
 *      {@link OptInPort} — a non-opted-in user contributes NOTHING.
 */

/** The de-identified signal kinds the market model aggregates (extensible). */
export type MarketSignalKind =
  /** Which tailoring emphasis correlated with a callback for a role cohort. */
  | 'tailoring_emphasis_callback'
  /** A skill-demand shift observed for a role cohort. */
  | 'skill_demand_shift';

/**
 * A single user's de-identified market signal BEFORE aggregation.
 *
 * `userId` is retained ONLY for opt-in gating + opt-out purge and is stripped
 * before any aggregate is emitted. `cohortKey` is the de-identified bucket the
 * signal belongs to (e.g. a role slug + emphasis label) — it must NOT encode
 * anything that could single out one person (no free-text, no ids).
 */
export interface RawContribution {
  /** Contributor identity — used for gating/purge ONLY, never emitted. */
  readonly userId: string;
  /** The signal family this contribution belongs to. */
  readonly kind: MarketSignalKind;
  /**
   * De-identified cohort bucket, e.g. `role:senior-frontend|emphasis:impact`.
   * Coarse by construction; never a free-text or per-user identifier.
   */
  readonly cohortKey: string;
  /**
   * Numeric observation contributed into the cohort (e.g. 1 = callback, 0 =
   * none; or a demand delta). Aggregation reduces these across contributors.
   */
  readonly value: number;
}

/**
 * A de-identified, aggregated market signal safe to expose to EVERY user.
 *
 * NOTE the ABSENCE of any per-user field: there is no `userId`, no list of
 * contributors, no raw values — only the cohort, the reduced statistic, and the
 * contributor COUNT (which is always ≥ the minimum-cohort threshold). This is
 * the ONLY shape the consumption side ever sees.
 */
export interface MarketAggregate {
  readonly kind: MarketSignalKind;
  readonly cohortKey: string;
  /** Mean of contributed values across the cohort (rounded, de-identified). */
  readonly mean: number;
  /** Distinct-contributor count. INVARIANT: always ≥ the minimum cohort size. */
  readonly contributorCount: number;
}

/** Opt-in decision for one user (checked against data_use_optins.cross_user_intel). */
export interface OptInPort {
  /** True IFF the user explicitly opted into cross-user market intelligence. */
  hasOptedIn(userId: string): Promise<boolean> | boolean;
}

/** Tuning knobs for the aggregation pass. */
export interface AggregationConfig {
  /**
   * k-anonymity minimum cohort size N. A cohort with fewer than N DISTINCT
   * contributors is suppressed entirely (never emitted). Must be ≥ 2 — a
   * threshold of 1 would permit single-user re-identification.
   */
  readonly minCohortSize: number;
}

/** Default k-anonymity threshold. Chosen ≥ 2 so no single user is re-identifiable. */
export const DEFAULT_MIN_COHORT_SIZE = 5;