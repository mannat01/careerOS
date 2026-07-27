/**
 * @careeros/cie-market-intel — M10 Step 2 cross-user market intelligence.
 *
 * Opt-in, de-identified, aggregated. The public surface exposes ONLY the pieces
 * needed to (1) contribute a de-identified signal behind the opt-in gate,
 * (2) rebuild the k-anonymized aggregate set, (3) purge on opt-out, and
 * (4) read the published aggregates. No raw per-user shape leaks past the
 * service boundary.
 */
export {
  type AggregationConfig,
  type MarketAggregate,
  type MarketSignalKind,
  type OptInPort,
  type RawContribution,
  DEFAULT_MIN_COHORT_SIZE,
} from './model.js';
export { aggregate } from './aggregator.js';
export {
  MarketIntelligenceService,
  type AggregateStorePort,
  type ContributionStorePort,
  type MarketIntelligenceDeps,
} from './service.js';
export { InMemoryAggregateStore, InMemoryContributionStore } from './stores.js';