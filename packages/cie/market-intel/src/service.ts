import { aggregate } from './aggregator.js';
import {
  DEFAULT_MIN_COHORT_SIZE,
  type AggregationConfig,
  type MarketAggregate,
  type OptInPort,
  type RawContribution,
} from './model.js';

/**
 * Narrow persistence port for raw, pre-aggregation contributions.
 *
 * Implementations MUST scope every method by userId where a userId is provided
 * — the store is the ONLY place raw per-user rows live, and they never leave it
 * except as de-identified aggregates produced by {@link MarketIntelligenceService.rebuild}.
 */
export interface ContributionStorePort {
  /** Persist (or replace) the caller's contribution for a (kind, cohortKey). */
  upsertContribution(contribution: RawContribution): Promise<void>;
  /** Delete ALL of one user's contributions (opt-out purge). */
  purgeUser(userId: string): Promise<void>;
  /** Read every stored contribution (used only inside rebuild). */
  listAllContributions(): Promise<RawContribution[]>;
}

/**
 * Narrow read/write port for the materialized, de-identified aggregate set.
 * Only {@link MarketAggregate}s (never raw rows) are ever written or read here,
 * so the consumption surface is structurally incapable of returning per-user
 * data.
 */
export interface AggregateStorePort {
  /** Replace the entire published aggregate set atomically (rebuild output). */
  replaceAll(aggregates: readonly MarketAggregate[]): Promise<void>;
  /** Read the published aggregates (optionally filtered by kind). */
  listAggregates(kind?: string): Promise<MarketAggregate[]>;
}

export interface MarketIntelligenceDeps {
  readonly optIn: OptInPort;
  readonly contributions: ContributionStorePort;
  readonly aggregates: AggregateStorePort;
  /** Optional override for the k-anonymity threshold (defaults to N=5). */
  readonly config?: Partial<AggregationConfig>;
}

/**
 * M10 Step 2 — Cross-user Market Intelligence service.
 *
 * PRIVACY INVARIANTS (each a launch-blocker security test):
 *
 *   (a) NON-OPTED-IN CONTRIBUTES NOTHING — {@link contribute} checks the
 *       caller's opt-in via the OptInPort BEFORE persisting. A user who has not
 *       set `data_use_optins.cross_user_intel = true` is a silent no-op; their
 *       data never enters the raw store, so it can never reach an aggregate.
 *
 *   (b) NO IDENTIFIABLE DATA IS EXPOSED — {@link getAggregates} returns ONLY
 *       {@link MarketAggregate}s from the aggregate store. That type has no
 *       userId field, and the raw store is never read on this path.
 *
 *   (c) TINY COHORTS ARE SUPPRESSED — {@link rebuild} runs the k-anonymity
 *       aggregator, which drops any cohort below the minimum size, so a
 *       cohort-of-one can't be used to re-identify a contributor.
 *
 *   (d) OPT-OUT PURGES PRIOR CONTRIBUTION — {@link optOut} deletes the user's
 *       raw rows AND rebuilds, so their signal is gone from the very next
 *       published aggregate set (not just from future contributions).
 */
export class MarketIntelligenceService {
  private readonly config: AggregationConfig;

  constructor(private readonly deps: MarketIntelligenceDeps) {
    this.config = {
      minCohortSize: deps.config?.minCohortSize ?? DEFAULT_MIN_COHORT_SIZE,
    };
  }

  /**
   * Contribute one de-identified signal on behalf of `userId`.
   *
   * OPT-IN GATE (invariant a): if the user has NOT opted in, this is a no-op and
   * returns `false` — NOTHING is persisted. A returned `true` means the signal
   * was accepted into the raw store (and will surface only as an aggregate once
   * the cohort clears the k-anon threshold on the next rebuild).
   */
  async contribute(contribution: RawContribution): Promise<boolean> {
    const optedIn = await this.deps.optIn.hasOptedIn(contribution.userId);
    if (!optedIn) return false;
    await this.deps.contributions.upsertContribution(contribution);
    return true;
  }

  /**
   * Rebuild the published aggregate set from ALL currently-stored contributions.
   *
   * Re-checks opt-in for every distinct contributor at rebuild time (defense in
   * depth): even if a raw row survived (e.g. a race with opt-out), a user who is
   * no longer opted in is excluded here too. Then runs the k-anon aggregator and
   * atomically replaces the published set.
   */
  async rebuild(): Promise<MarketAggregate[]> {
    const all = await this.deps.contributions.listAllContributions();

    // Defense in depth: filter to still-opted-in contributors before aggregating.
    const optInCache = new Map<string, boolean>();
    const eligible: RawContribution[] = [];
    for (const c of all) {
      let optedIn = optInCache.get(c.userId);
      if (optedIn === undefined) {
        optedIn = await this.deps.optIn.hasOptedIn(c.userId);
        optInCache.set(c.userId, optedIn);
      }
      if (optedIn) eligible.push(c);
    }

    const aggregates = aggregate(eligible, this.config);
    await this.deps.aggregates.replaceAll(aggregates);
    return aggregates;
  }

  /**
   * Opt-out lifecycle (invariant d): purge the user's raw contributions AND
   * rebuild so their prior contribution is removed from the published aggregate
   * set immediately — not merely excluded from future contributions.
   */
  async optOut(userId: string): Promise<MarketAggregate[]> {
    await this.deps.contributions.purgeUser(userId);
    return this.rebuild();
  }

  /**
   * Consumption surface (invariant b): the market model reads ONLY the
   * de-identified aggregate set. There is no code path from here to a raw
   * per-user row — the return type cannot carry a userId.
   */
  async getAggregates(kind?: string): Promise<MarketAggregate[]> {
    return this.deps.aggregates.listAggregates(kind);
  }
}