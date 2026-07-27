/**
 * M10 Step 3 — composition-root adapter for negotiation guidance.
 *
 * The negotiation package's {@link MarketCompRangePort} is intentionally
 * narrow — it accepts ONLY de-identified market comp signals (cohortKey +
 * meanTotal + contributorCount). This adapter derives those signals from the
 * sanctioned `MarketAggregate` set exposed by @careeros/cie-market-intel,
 * filtering to compensation-shaped cohortKeys (prefix `comp:`). Because the
 * source is the already-k-anonymized aggregate set, NO per-user data can leak
 * through this path.
 *
 * Boundaries: negotiation package NEVER imports @careeros/db and NEVER
 * imports @careeros/cie-market-intel; this adapter lives on the app side and
 * bridges the two ports.
 */
import type {
  CompensationRangeSignal,
  MarketCompRangePort,
} from '@careeros/cie-reasoning';
import type { MarketAggregate, MarketIntelligenceService } from '@careeros/cie-market-intel';

/**
 * Adapts the sanctioned MarketIntelligenceService aggregate stream onto the
 * negotiation-guidance MarketCompRangePort. Filters to comp-shaped cohorts
 * (`comp:*` cohortKey convention) and treats the aggregate's `mean` as the
 * cohort's mean total-comp in currency-neutral units.
 */
export class MarketIntelCompRangeAdapter implements MarketCompRangePort {
  constructor(private readonly service: MarketIntelligenceService) {}

  async getRanges(): Promise<CompensationRangeSignal[]> {
    const aggregates = await this.service.getAggregates();
    return aggregates
      .filter((a): a is MarketAggregate => a.cohortKey.startsWith('comp:'))
      .map((a) => ({
        cohortKey: a.cohortKey,
        meanTotal: a.mean,
        contributorCount: a.contributorCount,
      }));
  }
}

/**
 * Fixed-signal adapter — useful for tests + local dev where the market-intel
 * pipeline has no `comp:*` aggregates yet. Returns exactly the signals it was
 * constructed with; never invents one.
 */
export class StaticMarketCompRangeAdapter implements MarketCompRangePort {
  constructor(private readonly signals: readonly CompensationRangeSignal[]) {}

  getRanges(): Promise<CompensationRangeSignal[]> {
    return Promise.resolve([...this.signals]);
  }
}