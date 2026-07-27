import type {
  AggregateStorePort,
  ContributionStorePort,
} from './service.js';
import type { MarketAggregate, RawContribution } from './model.js';

/**
 * In-memory {@link ContributionStorePort} — the raw per-user contribution store.
 *
 * Keyed by (userId, kind, cohortKey) so a user's later contribution for the same
 * cohort REPLACES the earlier one (idempotent upsert). `purgeUser` removes every
 * key belonging to a user — the opt-out primitive. The map values NEVER leave
 * this store except via {@link listAllContributions}, which is called ONLY by
 * the service's rebuild (aggregation) path.
 *
 * A Prisma-backed store honoring the same port lands with the persisted
 * `market_intel_contribution` table; nothing on the consumption path changes.
 */
export class InMemoryContributionStore implements ContributionStorePort {
  private readonly rows = new Map<string, RawContribution>();

  private keyOf(userId: string, kind: string, cohortKey: string): string {
    return `${userId}\u0000${kind}\u0000${cohortKey}`;
  }

  upsertContribution(contribution: RawContribution): Promise<void> {
    this.rows.set(
      this.keyOf(contribution.userId, contribution.kind, contribution.cohortKey),
      contribution,
    );
    return Promise.resolve();
  }

  purgeUser(userId: string): Promise<void> {
    const prefix = `${userId}\u0000`;
    for (const key of [...this.rows.keys()]) {
      if (key.startsWith(prefix)) this.rows.delete(key);
    }
    return Promise.resolve();
  }

  listAllContributions(): Promise<RawContribution[]> {
    return Promise.resolve([...this.rows.values()]);
  }
}

/**
 * In-memory {@link AggregateStorePort} — the published, de-identified aggregate
 * set. Holds ONLY {@link MarketAggregate}s (no userId can be stored here). The
 * consumption path reads exclusively from this store.
 */
export class InMemoryAggregateStore implements AggregateStorePort {
  private aggregates: MarketAggregate[] = [];

  replaceAll(aggregates: readonly MarketAggregate[]): Promise<void> {
    this.aggregates = [...aggregates];
    return Promise.resolve();
  }

  listAggregates(kind?: string): Promise<MarketAggregate[]> {
    const all = this.aggregates.map((a) => ({ ...a }));
    return Promise.resolve(kind ? all.filter((a) => a.kind === kind) : all);
  }
}