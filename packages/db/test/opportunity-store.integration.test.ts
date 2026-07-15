/**
 * Integration tests for PrismaOpportunityStore + opportunity-graph upsert —
 * milestone-04 §Deliverables ("persist opportunities via Prisma; integration
 * tests vs docker Postgres"). Runs against live Postgres (DATABASE_URL).
 *
 * Contract under test:
 *   1. PrismaOpportunityStore.upsertMany persists a batch and is idempotent on
 *      `(source, sourceRef)` — re-running with the same batch does NOT create
 *      new rows.
 *   2. `listDedupKeys()` returns EVERY distinct dedupKey across all persisted
 *      opportunities, so the ingestion service can dedup across sources.
 *   3. Wiring PrismaOpportunityStore + GraphMemoryService (as the sink) into
 *      IngestionService yields one canonical Opportunity per dedup key, with
 *      opportunity→company + opportunity→requires_skill edges upserted per
 *      user — and a second run adds NO new opportunities and NO new edges.
 *   4. Hard-deleting the parent User cascades the graph nodes; opportunities
 *      are GLOBAL (not per-user) and survive.
 *
 * Run: pnpm --filter @careeros/db test:integration
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  GreenhouseConnector,
  IngestionService,
  LeverConnector,
  UsaJobsConnector,
} from '@careeros/connectors';
import { FakeEmbedder, GraphMemoryService } from '@careeros/memory';
import { PrismaGraphStore } from '../src/stores/prisma-graph-store.js';
import { PrismaOpportunityStore } from '../src/stores/prisma-opportunity-store.js';

// eslint-disable-next-line no-restricted-properties
const DATABASE_URL = process.env.DATABASE_URL;
const itIfDb = DATABASE_URL ? it : it.skip;

const HERE = dirname(fileURLToPath(import.meta.url));
const CONNECTORS_SRC = join(HERE, '..', '..', 'connectors', 'src');
const NOW = '2026-07-14T12:00:00.000Z';

function loadFixture(rel: string): unknown {
  return JSON.parse(readFileSync(join(CONNECTORS_SRC, rel), 'utf8'));
}

async function makeUser(prisma: PrismaClient): Promise<string> {
  const userId = randomUUID();
  await prisma.user.create({
    data: {
      id: userId,
      email: `opp-${randomUUID()}@example.com`,
      authProviderId: `clerk|${userId}`,
      subscriptionTier: 'free',
      status: 'active',
    },
  });
  return userId;
}

describe('PrismaOpportunityStore + graph upsert (live Postgres)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    if (!DATABASE_URL) {
      console.warn('DATABASE_URL not set — skipping opportunity integration tests');
      return;
    }
    prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
  });

  itIfDb('persists a greenhouse batch and de-dupes on (source, sourceRef) across runs', async () => {
    const store = new PrismaOpportunityStore(prisma);
    const service = new IngestionService({ opportunityStore: store });
    const gh = new GreenhouseConnector({ boardToken: 'acmecorp', companyName: 'Acme Corp' });
    const fixture = loadFixture('greenhouse/fixtures/greenhouse-jobs.json');

    // First run.
    const first = await service.ingestNormalized(gh.normalize(fixture, NOW));
    expect(first.persisted.length).toBeGreaterThan(0);
    const persistedIds = new Set(first.persisted.map((p) => p.id));

    // Verify rows landed and dedupKey is queryable server-side.
    const dedupKeys = await store.listDedupKeys();
    for (const opp of first.persisted) expect(dedupKeys).toContain(opp.dedupKey);

    // Second run: same fixture. Composite UNIQUE on (source, sourceRef) means
    // upsertMany returns the SAME row ids, and no new rows are added.
    const second = await service.ingestNormalized(gh.normalize(fixture, NOW));
    // Cross-source dedup at the service layer means only INTRA-batch dedup +
    // "already persisted" dedup fire on run 2; no fresh persistence.
    expect(second.persisted).toHaveLength(0);
    for (const opp of first.persisted) {
      const round = await store.findByDedupKey(opp.dedupKey);
      expect(round).not.toBeNull();
      expect(persistedIds.has(round!.id)).toBe(true);
    }

    // Cleanup — opportunities are GLOBAL; delete via composite key.
    for (const opp of first.persisted) {
      await prisma.opportunity.delete({
        where: { sourceKey_sourceRef: { sourceKey: opp.source, sourceRef: opp.sourceRef } },
      });
    }
  });

  itIfDb('cross-source: same Acme posting from greenhouse + lever + usajobs collapses to ONE Opportunity row', async () => {
    const store = new PrismaOpportunityStore(prisma);
    const service = new IngestionService({ opportunityStore: store });
    const gh = new GreenhouseConnector({ boardToken: 'acmecorp', companyName: 'Acme Corp' });
    const lv = new LeverConnector({ site: 'acmecorp', companyName: 'Acme Corp' });
    const uj = new UsaJobsConnector({ keyword: 'software engineer' });

    const merged = [
      ...gh.normalize(loadFixture('greenhouse/fixtures/greenhouse-jobs.json'), NOW),
      ...lv.normalize(loadFixture('lever/fixtures/lever-postings.json'), NOW),
      ...uj.normalize(loadFixture('usajobs/fixtures/usajobs-search.json'), NOW),
    ];

    const acmeBackendKey = merged.find(
      (o) => o.company === 'Acme Corp' && o.role === 'Senior Backend Engineer' && o.location === 'Remote - US',
    )?.dedupKey;
    expect(acmeBackendKey).toBeDefined();

    const result = await service.ingestNormalized(merged);
    // Exactly one row in the DB carries that dedupKey after ingestion.
    const rowsForKey = await prisma.opportunity.count({ where: { dedupKey: acmeBackendKey! } });
    expect(rowsForKey).toBe(1);
    // The canonical row is queryable by dedupKey.
    const canonical = await store.findByDedupKey(acmeBackendKey!);
    expect(canonical).not.toBeNull();
    expect(canonical!.company).toBe('Acme Corp');

    // Cleanup by composite natural key.
    for (const opp of result.persisted) {
      await prisma.opportunity.delete({
        where: { sourceKey_sourceRef: { sourceKey: opp.source, sourceRef: opp.sourceRef } },
      });
    }
  });

  itIfDb('graph upsert on ingest: opportunity → company + opportunity → skill edges land in Postgres per-user (idempotent)', async () => {
    const store = new PrismaOpportunityStore(prisma);
    const graphStore = new PrismaGraphStore(prisma);
    const graphService = new GraphMemoryService(graphStore, new FakeEmbedder());
    const service = new IngestionService({ opportunityStore: store, graphSink: graphService });
    const lv = new LeverConnector({ site: 'acmecorp', companyName: 'Acme Corp' });

    const userId = await makeUser(prisma);
    const opps = lv.normalize(loadFixture('lever/fixtures/lever-postings.json'), NOW);

    const first = await service.ingestNormalized(opps, { userId });
    expect(first.persisted.length).toBeGreaterThan(0);
    expect(first.graphUpserts).toBe(first.persisted.length);

    const nodesAfterFirst = await prisma.graphNode.count({ where: { userId } });
    const edgesAfterFirst = await prisma.graphEdge.count({ where: { userId } });
    expect(nodesAfterFirst).toBeGreaterThan(0);
    expect(edgesAfterFirst).toBeGreaterThan(0);

    // Assert the shape: at least one company node named "Acme Corp" exists for this user.
    const acmeCompany = await prisma.graphNode.findFirst({
      where: { userId, kind: 'company', label: 'Acme Corp' },
    });
    expect(acmeCompany).not.toBeNull();
    // …and there is at least one requires_skill edge (attrs.relation).
    const skillEdges = await prisma.graphEdge.findMany({ where: { userId } });
    const hasRequiresSkill = skillEdges.some((e) => {
      const attrs = e.attrs as { relation?: string } | null;
      return attrs?.relation === 'requires_skill';
    });
    expect(hasRequiresSkill).toBe(true);

    // Second ingest run: idempotent. No new opportunities. No new graph rows.
    // The service dedups first (dedupKey already persisted), so persisted=0 and
    // graphUpserts=0 — nodes/edges counts must not change.
    graphService.clearUpsertCache();
    const second = await service.ingestNormalized(opps, { userId });
    expect(second.persisted).toHaveLength(0);
    expect(second.graphUpserts).toBe(0);
    expect(await prisma.graphNode.count({ where: { userId } })).toBe(nodesAfterFirst);
    expect(await prisma.graphEdge.count({ where: { userId } })).toBe(edgesAfterFirst);

    // Hard-delete the user: graph rows cascade; opportunities are GLOBAL and remain.
    const persistedOppIds = first.persisted.map((o) => o.id);
    await prisma.user.delete({ where: { id: userId } });
    expect(await prisma.graphNode.count({ where: { userId } })).toBe(0);
    expect(await prisma.graphEdge.count({ where: { userId } })).toBe(0);
    const survivingOpps = await prisma.opportunity.findMany({ where: { id: { in: persistedOppIds } } });
    expect(survivingOpps.length).toBe(persistedOppIds.length);

    // Cleanup remaining global opps.
    for (const opp of first.persisted) {
      await prisma.opportunity.delete({
        where: { sourceKey_sourceRef: { sourceKey: opp.source, sourceRef: opp.sourceRef } },
      });
    }
  });
});
