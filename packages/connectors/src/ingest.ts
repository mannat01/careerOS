import type { Opportunity } from '@careeros/contracts';
import { dedupeOpportunities } from './dedup.js';
import type { GuardedFetch } from './fetch.js';
import type { SourceConnector } from './source-connector.js';

/**
 * IngestionService — the fetch → normalize → dedup → persist → graph-upsert
 * pipeline (milestone-04 §Deliverables). Adapters supply Opportunities; this
 * service is the composition point that turns them into rows in the
 * `opportunities` table AND (optionally) into per-user Career Knowledge Graph
 * nodes/edges via the M02 graph. Every collaborator is injected — the service
 * itself is transport-free and can be tested with in-memory fakes.
 *
 * Cross-source dedup: the `dedupKey` (sha256 of normalized company/role/
 * location) is a content identity, NOT a source ref, so the same posting seen
 * from Greenhouse + Lever + USAJobs collapses to ONE canonical Opportunity.
 *
 * Idempotency: re-ingesting the same batch produces NO new rows and NO new
 * graph nodes/edges — the natural keys (`(source_key, source_ref)` for
 * opportunities, `(userId, kind, key)` for graph nodes, `(userId, from, to,
 * type)` for edges) enforce this at the store level.
 */

// ---------------- store PORTS (adapters implement in @careeros/db) ----------------

/**
 * Persistence PORT for canonical Opportunity rows. Implemented by
 * `PrismaOpportunityStore` in @careeros/db; the in-memory fake in
 * `test/fakes.ts` covers unit tests.
 *
 * `upsert` is keyed on the composite `(source, sourceRef)` UNIQUE constraint
 * (database-schema.md §2) — re-ingesting the same posting from the SAME source
 * updates in place; the same posting from a DIFFERENT source dedupes via
 * `dedupKey` at the service layer BEFORE reaching this store.
 */
export interface OpportunityStore {
  /** Return existing dedup keys we've already persisted (for cross-source dedup). */
  listDedupKeys(): Promise<string[]>;
  /** Upsert a batch on `(source, sourceRef)`. Returns rows post-upsert with ids. */
  upsertMany(opps: readonly Opportunity[]): Promise<IngestedOpportunity[]>;
  /** Read a canonical Opportunity by its `dedupKey` — used to link the graph. */
  findByDedupKey(dedupKey: string): Promise<IngestedOpportunity | null>;
}

/**
 * An Opportunity as returned by the store — same shape as the contract plus a
 * generated `id` (the row PK we need for graph edge `refId`s).
 */
export interface IngestedOpportunity extends Opportunity {
  id: string;
}

/**
 * Minimal per-user graph write PORT the ingestion service needs. This is a
 * strict subset of the M02 `GraphMemoryService` surface — passing the whole
 * service is fine (structural typing), but keeping the PORT narrow lets a fake
 * ingest test avoid depending on the entire memory package.
 */
export interface OpportunityGraphSink {
  upsertOpportunityGraph(
    userId: string,
    input: {
      opportunityId: string;
      role: string;
      company: string;
      requiredSkills: readonly string[];
    },
  ): Promise<void>;
}

// ---------------- result shapes ----------------

export interface IngestResult {
  /** Every opportunity normalized by the adapter, in adapter order. */
  normalized: Opportunity[];
  /** Fresh opportunities (dedup-key not previously seen in-store OR in-batch). */
  fresh: Opportunity[];
  /** Opportunities skipped as duplicates (of an existing store row or in-batch). */
  duplicates: Opportunity[];
  /** Rows persisted this run (only the fresh ones; store returns them with ids). */
  persisted: IngestedOpportunity[];
  /** Per-source keys of fresh opportunities we upserted graph nodes/edges for. */
  graphUpserts: number;
}

// ---------------- service ----------------

export interface IngestionServiceOptions {
  opportunityStore: OpportunityStore;
  /** Optional: when supplied, fresh opportunities also upsert into this user's graph. */
  graphSink?: OpportunityGraphSink;
}

export class IngestionService {
  constructor(private readonly opts: IngestionServiceOptions) {}

  /**
   * Run the full pipeline for one connector: fetch (guarded) → normalize
   * (sanitize inside adapter) → dedup (in-batch + against store) → persist →
   * graph-upsert (if `userId` supplied and a `graphSink` is configured).
   */
  async ingest(
    connector: SourceConnector,
    fetcher: GuardedFetch,
    nowIso: string,
    scope?: { userId?: string },
  ): Promise<IngestResult> {
    const raw = await connector.fetchRaw(fetcher);
    const normalized = connector.normalize(raw, nowIso);
    return this.ingestNormalized(normalized, scope);
  }

  /**
   * Ingest an already-normalized batch (test seam + supports MULTI-source runs
   * where the caller has merged batches from several adapters). Cross-source
   * dedup happens here.
   */
  async ingestNormalized(
    normalized: readonly Opportunity[],
    scope?: { userId?: string },
  ): Promise<IngestResult> {
    const existingKeys = new Set(await this.opts.opportunityStore.listDedupKeys());
    const { fresh, duplicates } = dedupeOpportunities(normalized, existingKeys);

    const persisted = fresh.length > 0
      ? await this.opts.opportunityStore.upsertMany(fresh)
      : [];

    let graphUpserts = 0;
    const userId = scope?.userId;
    const sink = this.opts.graphSink;
    if (userId !== undefined && sink !== undefined) {
      for (const opp of persisted) {
        await sink.upsertOpportunityGraph(userId, {
          opportunityId: opp.id,
          role: opp.role,
          company: opp.company,
          requiredSkills: extractRequiredSkills(opp),
        });
        graphUpserts += 1;
      }
    }

    return {
      normalized: [...normalized],
      fresh,
      duplicates,
      persisted,
      graphUpserts,
    };
  }
}

// ---------------- required-skill extraction (M04 Step 1 stand-in) ----------------

/**
 * Extract a canonical, de-duplicated list of skill labels from an Opportunity
 * for graph upsert. The full requirements parser is an M04 scoring-step concern
 * (per milestone-04 §Deliverables). Step 1 just needs a deterministic list of
 * skill nodes to create edges to; we scan the sanitized description(s) already
 * on `rawPayload` for a small, hand-curated vocabulary of common tech skills.
 * Injection markers in `rawPayload.injectionFlags` are ignored on purpose: this
 * function operates on the SANITIZED text, and would produce the same result
 * whether or not the raw payload attempted a prompt injection.
 */
export function extractRequiredSkills(opp: Opportunity): string[] {
  const payload = opp.rawPayload;
  const parts: string[] = [];
  for (const key of ['contentSanitized', 'descriptionSanitized']) {
    const v = payload[key];
    if (typeof v === 'string') parts.push(v);
  }
  const haystack = `${opp.role} ${parts.join(' ')}`.toLowerCase();

  const VOCAB: ReadonlyArray<readonly [string, RegExp]> = [
    ['TypeScript', /\btypescript\b/],
    ['JavaScript', /\bjavascript\b/],
    ['Python', /\bpython\b/],
    ['Go', /\bgo\b|\bgolang\b/],
    ['Java', /\bjava\b(?!script)/],
    ['Ruby', /\bruby\b/],
    ['Rust', /\brust\b/],
    ['C++', /\bc\+\+\b/],
    ['PostgreSQL', /\bpostgres(?:ql)?\b/],
    ['Redis', /\bredis\b/],
    ['Kubernetes', /\bkubernetes\b|\bk8s\b/],
    ['Docker', /\bdocker\b/],
    ['React', /\breact\b/],
    ['Node.js', /\bnode\.?js\b/],
    ['AWS', /\baws\b/],
    ['GCP', /\bgcp\b|\bgoogle cloud\b/],
    ['PyTorch', /\bpytorch\b/],
    ['TensorFlow', /\btensorflow\b/],
    ['Machine Learning', /\bmachine learning\b|\bml\b/],
    ['Design Systems', /\bdesign systems?\b/],
    ['Product Design', /\bproduct design(?:er)?\b/],
    ['Cybersecurity', /\bcybersecurity\b|\bincident response\b/],
    ['Event-Driven Systems', /\bevent[- ]driven\b/],
  ];

  const found: string[] = [];
  const seen = new Set<string>();
  for (const [label, re] of VOCAB) {
    if (re.test(haystack) && !seen.has(label)) {
      found.push(label);
      seen.add(label);
    }
  }
  return found;
}
