import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Opportunity } from '@careeros/contracts';
import {
  GreenhouseConnector,
  IngestionService,
  LeverConnector,
  UsaJobsConnector,
  type IngestedOpportunity,
  type OpportunityGraphSink,
  type OpportunityStore,
} from '../src/index.js';

/**
 * Cross-source ingestion tests — milestone-04 acceptance:
 *   1. Ingesting from ≥2 sources persists deduped opportunities.
 *   2. The same posting seen from two sources dedups to ONE canonical
 *      Opportunity (by dedupKey).
 *   3. Fresh opportunities trigger graph upserts (opportunity → company +
 *      opportunity → required-skill). Duplicates do NOT.
 *   4. A second ingest run is idempotent (no new rows, no new graph writes).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const readFixture = (rel: string): unknown => JSON.parse(readFileSync(join(HERE, '..', 'src', rel), 'utf8'));

const greenhouseFixture = readFixture('greenhouse/fixtures/greenhouse-jobs.json');
const leverFixture = readFixture('lever/fixtures/lever-postings.json');
const usajobsFixture = readFixture('usajobs/fixtures/usajobs-search.json');

const NOW = '2026-07-14T12:00:00.000Z';

// ---------------- fakes ----------------

class InMemoryOpportunityStore implements OpportunityStore {
  private readonly rows = new Map<string, IngestedOpportunity>(); // key: `${source}\u0000${sourceRef}`
  private readonly byDedup = new Map<string, IngestedOpportunity>();

  private naturalKey(opp: Opportunity): string {
    return `${opp.source}\u0000${opp.sourceRef}`;
  }

  listDedupKeys(): Promise<string[]> {
    return Promise.resolve([...this.byDedup.keys()]);
  }

  upsertMany(opps: readonly Opportunity[]): Promise<IngestedOpportunity[]> {
    const out: IngestedOpportunity[] = [];
    for (const opp of opps) {
      const natural = this.naturalKey(opp);
      const existing = this.rows.get(natural);
      const id = existing?.id ?? randomUUID();
      const row: IngestedOpportunity = { ...opp, id };
      this.rows.set(natural, row);
      // dedupKey may already point at a row from a DIFFERENT source (that's the
      // WHOLE POINT of cross-source dedup) — never overwrite the canonical row.
      if (!this.byDedup.has(opp.dedupKey)) this.byDedup.set(opp.dedupKey, row);
      out.push(row);
    }
    return Promise.resolve(out);
  }

  findByDedupKey(dedupKey: string): Promise<IngestedOpportunity | null> {
    return Promise.resolve(this.byDedup.get(dedupKey) ?? null);
  }


  /** Test-only: inspect current row count. */
  size(): number {
    return this.rows.size;
  }
}

interface GraphUpsertInput {
  opportunityId: string;
  company: string;
  role: string;
  requiredSkills: readonly string[];
}
type GraphUpsertCall = GraphUpsertInput & { userId: string };

class RecordingGraphSink implements OpportunityGraphSink {
  readonly calls: GraphUpsertCall[] = [];
  upsertOpportunityGraph(userId: string, input: GraphUpsertInput): Promise<void> {
    this.calls.push({ userId, ...input });
    return Promise.resolve();
  }
}


// ---------------- tests ----------------

describe('cross-source ingestion → canonical Opportunity + graph', () => {
  it('collapses the same Acme "Senior Backend Engineer / Remote - US" posting across greenhouse + lever + usajobs to ONE row', async () => {
    const gh = new GreenhouseConnector({ boardToken: 'acmecorp', companyName: 'Acme Corp' });
    const lv = new LeverConnector({ site: 'acmecorp', companyName: 'Acme Corp' });
    const uj = new UsaJobsConnector({ keyword: 'software engineer' });

    const merged: Opportunity[] = [
      ...gh.normalize(greenhouseFixture, NOW),
      ...lv.normalize(leverFixture, NOW),
      ...uj.normalize(usajobsFixture, NOW),
    ];

    // Sanity: every source produced its own Acme/Senior Backend Engineer/Remote-US
    // posting, so pre-dedup the dedupKey appears MULTIPLE times.
    const acmeKeyOccurrences = merged.filter(
      (o) => o.company === 'Acme Corp' && o.role === 'Senior Backend Engineer' && o.location === 'Remote - US',
    );
    expect(acmeKeyOccurrences.length).toBeGreaterThanOrEqual(3);
    // …and they share ONE identity.
    const uniqueAcmeKeys = new Set(acmeKeyOccurrences.map((o) => o.dedupKey));
    expect(uniqueAcmeKeys.size).toBe(1);

    const store = new InMemoryOpportunityStore();
    const service = new IngestionService({ opportunityStore: store });
    const result = await service.ingestNormalized(merged);

    // Cross-source dedup wins: the Acme backend job is persisted ONCE, and the
    // two extra source rows are recorded as duplicates.
    const acmePersisted = result.persisted.filter(
      (o) => o.company === 'Acme Corp' && o.role === 'Senior Backend Engineer',
    );
    expect(acmePersisted).toHaveLength(1);
    const acmeDuplicates = result.duplicates.filter(
      (o) => o.company === 'Acme Corp' && o.role === 'Senior Backend Engineer',
    );
    // greenhouse repost + lever cross-post + usajobs cross-post = 3 dupes past
    // the canonical row (2 cross-source + 1 intra-greenhouse repost).
    expect(acmeDuplicates.length).toBeGreaterThanOrEqual(2);

    // Overall row count is strictly less than the pre-dedup count.
    expect(store.size()).toBeLessThan(merged.length);
    expect(result.duplicates.length + result.fresh.length).toBe(merged.length);
  });

  it('a second ingest pass creates NO new opportunities and NO new graph writes (idempotent)', async () => {
    const gh = new GreenhouseConnector({ boardToken: 'acmecorp', companyName: 'Acme Corp' });
    const lv = new LeverConnector({ site: 'acmecorp', companyName: 'Acme Corp' });
    const store = new InMemoryOpportunityStore();
    const graph = new RecordingGraphSink();
    const service = new IngestionService({ opportunityStore: store, graphSink: graph });

    const merged: Opportunity[] = [
      ...gh.normalize(greenhouseFixture, NOW),
      ...lv.normalize(leverFixture, NOW),
    ];
    const userId = randomUUID();

    const first = await service.ingestNormalized(merged, { userId });
    const rowsAfterFirst = store.size();
    const graphCallsAfterFirst = graph.calls.length;
    expect(first.persisted.length).toBe(rowsAfterFirst);
    expect(first.graphUpserts).toBe(rowsAfterFirst);
    expect(graphCallsAfterFirst).toBe(rowsAfterFirst);

    const second = await service.ingestNormalized(merged, { userId });
    // No new rows, no new graph writes — the store's dedup-key set + the
    // opportunity/graph unique constraints make ingestion fully idempotent.
    expect(store.size()).toBe(rowsAfterFirst);
    expect(second.persisted).toHaveLength(0);
    expect(second.graphUpserts).toBe(0);
    expect(graph.calls.length).toBe(graphCallsAfterFirst);
    expect(second.duplicates).toHaveLength(merged.length);
  });

  it('upserts opportunity → company + opportunity → required-skill edges into the per-user graph', async () => {
    const lv = new LeverConnector({ site: 'acmecorp', companyName: 'Acme Corp' });
    const store = new InMemoryOpportunityStore();
    const graph = new RecordingGraphSink();
    const service = new IngestionService({ opportunityStore: store, graphSink: graph });

    const opps = lv.normalize(leverFixture, NOW);
    const userId = randomUUID();
    const result = await service.ingestNormalized(opps, { userId });

    // The lever fixture has three DIFFERENT dedup keys → three graph upserts.
    expect(result.persisted).toHaveLength(3);
    expect(graph.calls).toHaveLength(3);

    // Backend posting must have at least the vocab we advertise in extractRequiredSkills.
    const backend = graph.calls.find((c) => c.role === 'Senior Backend Engineer');
    expect(backend).toBeDefined();
    expect(backend!.userId).toBe(userId);
    expect(backend!.company).toBe('Acme Corp');
    const skills = new Set(backend!.requiredSkills);
    expect(skills.has('TypeScript')).toBe(true);
    expect(skills.has('PostgreSQL')).toBe(true);
    expect(skills.has('Redis')).toBe(true);

    // ML posting: python + pytorch appear in the sanitized description.
    const ml = graph.calls.find((c) => c.role === 'Machine Learning Engineer');
    expect(ml).toBeDefined();
    const mlSkills = new Set(ml!.requiredSkills);
    expect(mlSkills.has('Python')).toBe(true);
    expect(mlSkills.has('PyTorch')).toBe(true);
  });

  it('skipping the graph sink still persists opportunities (userId supplied but no sink → no graph writes)', async () => {
    const gh = new GreenhouseConnector({ boardToken: 'acmecorp', companyName: 'Acme Corp' });
    const store = new InMemoryOpportunityStore();
    const service = new IngestionService({ opportunityStore: store }); // no sink
    const result = await service.ingestNormalized(gh.normalize(greenhouseFixture, NOW), { userId: randomUUID() });
    expect(result.persisted.length).toBeGreaterThan(0);
    expect(result.graphUpserts).toBe(0);
  });
});
