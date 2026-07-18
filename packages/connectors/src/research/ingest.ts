/**
 * Research findings ingestion — the M07 Step 3 pipeline that turns a set of
 * sanctioned source adapters + fixtures into persisted, deduped ResearchFinding
 * rows plus per-user graph `evidenced_by` edges linking each finding to the
 * skill/company/industry entities it concerns.
 *
 * Same shape as `packages/connectors/src/ingest.ts` (the M04 opportunity
 * ingestion): the service is DB-free; it depends on narrow ports whose Prisma
 * adapters live in @careeros/db. Idempotent by construction — the store's
 * `(sourceKey, sourceRef)` unique index guarantees re-ingesting the same
 * fixture upserts in place, and the graph linker's upsert-edge semantics mean
 * re-linking the same finding→entity twice creates no duplicate edges.
 *
 * PER-USER graph linking: findings are GLOBAL (market-wide) but the evidence
 * edges are PER-USER. The linker mints edges only for entities that already
 * appear on the user's graph (skill/company/industry nodes) — so users A and B
 * accumulate different personalized evidence trails from the SAME finding.
 */
import type {
  NormalizedResearchFinding,
  ResearchSourceAdapter,
  ResearchSourceRegistry,
} from './types.js';
import { ResearchSourceNotAllowedError } from './registry.js';
import type { GuardedFetch } from '../fetch.js';

/** Narrow store port the pipeline depends on (Prisma adapter lives in @careeros/db). */
export interface ResearchFindingStorePort {
  /**
   * Upsert a batch of findings idempotently on `(sourceKey, sourceRef)`.
   * Returns the count that was newly inserted (excluding no-op refreshes).
   */
  upsertMany(findings: NormalizedResearchFinding[]): Promise<{
    inserted: number;
    updated: number;
  }>;
}

/**
 * Narrow graph-linking port. For every finding, the linker is asked to mint
 * `evidenced_by` edges from each entity node (skill/company/industry) on the
 * user's graph to a per-finding evidence node. Idempotent.
 */
export interface ResearchGraphLinkPort {
  linkFindingsToUserGraph(input: {
    userId: string;
    findings: NormalizedResearchFinding[];
  }): Promise<{ edgesUpserted: number; entitiesTouched: number }>;
}

export interface ResearchIngestionResult {
  totalFindings: number;
  inserted: number;
  updated: number;
  bySource: Array<{ sourceKey: string; count: number }>;
  graphEdgesUpserted: number;
  graphEntitiesTouched: number;
  injectionFlags: Array<{ sourceKey: string; sourceRef: string; flags: string[] }>;
  blocked: Array<{ sourceKey: string; reason: string }>;
}

export interface ResearchIngestionServiceOptions {
  registry: ResearchSourceRegistry;
  guardedFetch: GuardedFetch;
  store: ResearchFindingStorePort;
  clock?: () => Date;
}

/**
 * The ingestion pipeline. `ingestForUser` links findings into ONE user's graph.
 * `ingest` (without user) is the market-wide persist-only path — the same
 * global findings, no per-user linking. The scheduler step (out-of-scope here)
 * will iterate users and call `ingestForUser` for each.
 */
export class ResearchIngestionService {
  private readonly clock: () => Date;

  constructor(private readonly opts: ResearchIngestionServiceOptions) {
    this.clock = opts.clock ?? (() => new Date());
  }

  /**
   * Persist-only ingestion (no per-user graph linking). Returns dedupe stats.
   *
   * A non-allow-listed adapter is REPORTED (in `blocked`) — not thrown — so a
   * scheduler running all sources doesn't abort on one disabled source. The
   * `source_not_allowed` code from the guarded fetch is the same one the M04
   * opportunity path uses.
   */
  async ingest(adapters: readonly ResearchSourceAdapter[]): Promise<ResearchIngestionResult> {
    const nowIso = this.clock().toISOString();
    const all: NormalizedResearchFinding[] = [];
    const bySource: Array<{ sourceKey: string; count: number }> = [];
    const blocked: Array<{ sourceKey: string; reason: string }> = [];

    for (const adapter of adapters) {
      const entry = this.opts.registry.getByKey(adapter.sourceKey);
      if (!entry || !entry.enabled) {
        blocked.push({
          sourceKey: adapter.sourceKey,
          reason: 'source_not_allowed',
        });
        continue;
      }
      try {
        const raw = await adapter.fetchRaw(this.opts.guardedFetch);
        const findings = adapter.normalize(raw, nowIso);
        all.push(...findings);
        bySource.push({ sourceKey: adapter.sourceKey, count: findings.length });
      } catch (err) {
        if (err instanceof ResearchSourceNotAllowedError || (err as { code?: string })?.code === 'source_not_allowed') {
          blocked.push({
            sourceKey: adapter.sourceKey,
            reason: 'source_not_allowed',
          });
          continue;
        }
        throw err;
      }
    }

    const { inserted, updated } = await this.opts.store.upsertMany(all);
    const injectionFlags = all
      .filter((f) => f.rawRef.injectionFlags.length > 0)
      .map((f) => ({
        sourceKey: f.sourceKey,
        sourceRef: f.sourceRef,
        flags: f.rawRef.injectionFlags,
      }));
    return {
      totalFindings: all.length,
      inserted,
      updated,
      bySource,
      graphEdgesUpserted: 0,
      graphEntitiesTouched: 0,
      injectionFlags,
      blocked,
    };
  }

  /**
   * Ingest + link to ONE user's graph. Findings are still global (persisted
   * once, dedup'd on `(sourceKey, sourceRef)`); the graph edges are per-user.
   */
  async ingestForUser(
    userId: string,
    adapters: readonly ResearchSourceAdapter[],
    linker: ResearchGraphLinkPort,
  ): Promise<ResearchIngestionResult> {
    const baseResult = await this.ingest(adapters);
    if (baseResult.totalFindings === 0) return baseResult;
    // Re-materialize the normalized batch for linking. Because upsertMany is
    // idempotent, we simply run the adapters again over the fixtures — cheap
    // and avoids storing the mid-batch buffer on the service. The linker owns
    // the "only mint edges for entities the user already has" filter.
    const nowIso = this.clock().toISOString();
    const rebuilt: NormalizedResearchFinding[] = [];
    for (const adapter of adapters) {
      const entry = this.opts.registry.getByKey(adapter.sourceKey);
      if (!entry || !entry.enabled) continue;
      try {
        const raw = await adapter.fetchRaw(this.opts.guardedFetch);
        rebuilt.push(...adapter.normalize(raw, nowIso));
      } catch {
        /* blocked source already reported */
      }
    }
    const { edgesUpserted, entitiesTouched } = await linker.linkFindingsToUserGraph({
      userId,
      findings: rebuilt,
    });
    return {
      ...baseResult,
      graphEdgesUpserted: edgesUpserted,
      graphEntitiesTouched: entitiesTouched,
    };
  }
}