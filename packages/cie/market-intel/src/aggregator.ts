import {
  type AggregationConfig,
  type MarketAggregate,
  type MarketSignalKind,
  type RawContribution,
} from './model.js';

/**
 * Deterministic k-anonymity aggregator — the privacy heart of M10 Step 2.
 *
 * Given a set of already-opt-in-gated {@link RawContribution}s (the opt-in gate
 * lives in the service so a non-opted-in user's rows never reach here), it:
 *
 *   1. Groups contributions by (kind, cohortKey).
 *   2. Counts DISTINCT contributors per cohort (not row count — one user with
 *      many rows still counts once, so they cannot inflate a cohort past the
 *      threshold by themselves).
 *   3. SUPPRESSES any cohort with fewer than `minCohortSize` distinct
 *      contributors — nothing is emitted, so a tiny cohort can never be used to
 *      re-identify a contributor.
 *   4. Emits ONLY a {@link MarketAggregate} (no userId, no per-row values) for
 *      surviving cohorts.
 *
 * Pure + deterministic: same inputs ⇒ same outputs, no I/O, no clock.
 */
export function aggregate(
  contributions: readonly RawContribution[],
  config: AggregationConfig,
): MarketAggregate[] {
  const minCohortSize = Math.max(2, Math.floor(config.minCohortSize));

  // Group by (kind, cohortKey). Track the SET of distinct contributors and the
  // running value sum/count so we can compute the mean without retaining rows.
  interface Bucket {
    kind: MarketSignalKind;
    cohortKey: string;
    contributors: Set<string>;
    valueSum: number;
    valueCount: number;
  }
  const buckets = new Map<string, Bucket>();

  for (const c of contributions) {
    const groupId = `${c.kind}\u0000${c.cohortKey}`;
    let bucket = buckets.get(groupId);
    if (!bucket) {
      bucket = {
        kind: c.kind,
        cohortKey: c.cohortKey,
        contributors: new Set<string>(),
        valueSum: 0,
        valueCount: 0,
      };
      buckets.set(groupId, bucket);
    }
    bucket.contributors.add(c.userId);
    bucket.valueSum += c.value;
    bucket.valueCount += 1;
  }

  const out: MarketAggregate[] = [];
  for (const bucket of buckets.values()) {
    const contributorCount = bucket.contributors.size;
    // k-anonymity suppression: below-threshold cohorts are DROPPED entirely.
    if (contributorCount < minCohortSize) continue;
    const mean =
      bucket.valueCount === 0 ? 0 : roundTo(bucket.valueSum / bucket.valueCount, 4);
    out.push({
      kind: bucket.kind,
      cohortKey: bucket.cohortKey,
      mean,
      contributorCount,
    });
  }

  // Stable, deterministic ordering (kind then cohortKey) — no per-user data
  // influences ordering, so ordering cannot leak identity.
  out.sort((a, b) =>
    a.kind === b.kind ? a.cohortKey.localeCompare(b.cohortKey) : a.kind.localeCompare(b.kind),
  );
  return out;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}