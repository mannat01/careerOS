/**
 * Integration tests for the Prisma-backed GraphStore — run against live Postgres
 * (DATABASE_URL). They prove the DB honors the SAME contracts the in-memory fake
 * asserts in the memory package:
 *   - upsertNode is idempotent on (userId, kind, key); upsertEdge on
 *     (userId, from, to, type) — re-import duplicates NO rows.
 *   - Bidirectional edge traversal: edgesTouching returns edges from EITHER
 *     endpoint (backed by the from/to indexes).
 *   - PER-USER scoping: one user's reads never surface another user's nodes/edges.
 *   - Everything cascades on account hard-delete.
 *
 * Run: pnpm --filter @careeros/db test:integration
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { GraphMemoryService, FakeEmbedder, type GraphProfileInput } from '@careeros/memory';
import { PrismaGraphStore } from '../src/stores/prisma-graph-store.js';

const DATABASE_URL =
  // eslint-disable-next-line no-restricted-properties
  process.env.DATABASE_URL;
const itIfDb = DATABASE_URL ? it : it.skip;

const FIXTURE: GraphProfileInput = {
  personLabel: 'Ada Lovelace',
  experiences: [
    { company: 'Acme Corp', title: 'Senior Engineer', skills: ['TypeScript', 'PostgreSQL'] },
    { company: 'Globex', title: 'Staff Engineer', skills: ['TypeScript', 'Kubernetes'] },
  ],
  projects: [{ name: 'Nightscout', skills: ['TypeScript', 'React'] }],
  education: [{ institution: 'MIT', credential: 'BSc', field: 'Computer Science' }],
  skills: [{ name: 'TypeScript' }, { name: 'Leadership' }],
};

async function makeUser(prisma: PrismaClient): Promise<string> {
  const userId = randomUUID();
  await prisma.user.create({
    data: {
      id: userId,
      email: `graph-${randomUUID()}@example.com`,
      authProviderId: `clerk|${userId}`,
      subscriptionTier: 'free',
      status: 'active',
    },
  });
  return userId;
}

describe('Prisma graph store (live Postgres)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    if (!DATABASE_URL) {
      console.warn('DATABASE_URL not set — skipping graph integration tests');
      return;
    }
    prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
  });

  itIfDb('imports a fixture profile into a connected, idempotent graph', async () => {
    const userId = await makeUser(prisma);
    const store = new PrismaGraphStore(prisma);
    const service = new GraphMemoryService(store, new FakeEmbedder());

    await service.upsertFromProfile(userId, FIXTURE);

    const nodesAfterFirst = await service.listNodes(userId);
    const person = nodesAfterFirst.find((n) => n.kind === 'person')!;
    expect(person).toBeDefined();

    // Connected: every node reachable from the person root.
    const reached = await service.traverseNeighborhood({ userId, startNodeId: person.id, depth: 10 });
    expect(reached.nodes.map((n) => n.id).sort()).toEqual(nodesAfterFirst.map((n) => n.id).sort());

    // Re-import is idempotent — no duplicate rows in Postgres.
    service.clearUpsertCache();
    await service.upsertFromProfile(userId, FIXTURE);
    const nodesAfterSecond = await service.listNodes(userId);
    expect(nodesAfterSecond).toHaveLength(nodesAfterFirst.length);

    await prisma.user.delete({ where: { id: userId } });
    expect(await service.listNodes(userId)).toHaveLength(0);
  });

  itIfDb('depth-2 traversal from a skill node returns the expected neighborhood', async () => {
    const userId = await makeUser(prisma);
    const service = new GraphMemoryService(new PrismaGraphStore(prisma), new FakeEmbedder());
    await service.upsertFromProfile(userId, FIXTURE);

    const nodes = await service.listNodes(userId);
    const typescript = nodes.find((n) => n.kind === 'skill' && n.label === 'TypeScript')!;

    const d1 = await service.traverseNeighborhood({ userId, startNodeId: typescript.id, depth: 1 });
    const d1Labels = new Set(d1.nodes.map((n) => n.label));
    expect(d1Labels.has('PostgreSQL')).toBe(false); // 2 hops away

    const d2 = await service.traverseNeighborhood({ userId, startNodeId: typescript.id, depth: 2 });
    const d2Labels = new Set(d2.nodes.map((n) => n.label));
    expect(d2Labels.has('PostgreSQL')).toBe(true);
    expect(d2Labels.has('Kubernetes')).toBe(true);
    expect(d2Labels.has('React')).toBe(true);
    expect(d2.nodes.length).toBeGreaterThan(d1.nodes.length);

    await prisma.user.delete({ where: { id: userId } });
  });

  itIfDb('is PER-USER scoped — user A cannot read user B\'s graph', async () => {
    const userA = await makeUser(prisma);
    const userB = await makeUser(prisma);
    const service = new GraphMemoryService(new PrismaGraphStore(prisma), new FakeEmbedder());

    await service.upsertFromProfile(userA, FIXTURE);
    service.clearUpsertCache();
    await service.upsertFromProfile(userB, { ...FIXTURE, personLabel: 'Grace Hopper' });

    const aNodes = await service.listNodes(userA);
    const aPerson = aNodes.find((n) => n.kind === 'person')!;

    // User B cannot fetch a User A node by id.
    expect(await service.getNode(userB, aPerson.id)).toBeNull();

    // Traversal scoped to B never surfaces A's edges.
    const scoped = await service.traverseNeighborhood({ userId: userB, startNodeId: aPerson.id, depth: 3 });
    expect(scoped.edges).toHaveLength(0);

    await prisma.user.delete({ where: { id: userA } });
    await prisma.user.delete({ where: { id: userB } });
  });

  itIfDb('bidirectional edgesTouching returns edges from EITHER endpoint', async () => {
    const userId = await makeUser(prisma);
    const service = new GraphMemoryService(new PrismaGraphStore(prisma), new FakeEmbedder());
    await service.upsertFromProfile(userId, FIXTURE);

    const nodes = await service.listNodes(userId);
    const company = nodes.find((n) => n.kind === 'company' && n.label === 'Acme Corp')!;

    // Acme is a TARGET of a worked_at edge (person → company). Querying by the
    // company id must still return that edge — proving the to-endpoint index is used.
    const touching = await service.edgesTouching(userId, [company.id]);
    expect(touching.some((e) => e.type === 'worked_at' && e.toNodeId === company.id)).toBe(true);

    await prisma.user.delete({ where: { id: userId } });
  });
});
