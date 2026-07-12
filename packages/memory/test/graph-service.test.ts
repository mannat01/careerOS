import { describe, it, expect } from 'vitest';
import {
  GraphMemoryService,
  InMemoryGraphStore,
  FakeEmbedder,
  type GraphProfileInput,
} from '../src/index.js';

const USER = 'user-A';
const OTHER = 'user-B';

/** A representative extracted-profile fixture: two experiences, one project, one
 *  education, plus top-level skills — several skills SHARED across sources so the
 *  graph is genuinely connected (not a star of disjoint chains). */
const FIXTURE: GraphProfileInput = {
  profileId: 'profile-A',
  personLabel: 'Ada Lovelace',
  experiences: [
    { ref: 'exp-1', company: 'Acme Corp', title: 'Senior Engineer', skills: ['TypeScript', 'PostgreSQL'] },
    { ref: 'exp-2', company: 'Globex', title: 'Staff Engineer', skills: ['TypeScript', 'Kubernetes'] },
  ],
  projects: [{ ref: 'proj-1', name: 'Nightscout', skills: ['TypeScript', 'React'] }],
  education: [{ ref: 'edu-1', institution: 'MIT', credential: 'BSc', field: 'Computer Science' }],
  skills: [{ ref: 'sk-1', name: 'TypeScript' }, { ref: 'sk-2', name: 'Leadership' }],
};

function build(): { service: GraphMemoryService; store: InMemoryGraphStore } {
  const store = new InMemoryGraphStore();
  const service = new GraphMemoryService(store, new FakeEmbedder());
  return { service, store };
}

describe('GraphMemoryService.upsertFromProfile', () => {
  it('builds a connected graph from the fixture profile', async () => {
    const { service, store } = build();
    await service.upsertFromProfile(USER, FIXTURE);

    const nodes = await service.listNodes(USER);
    const byKind = (k: string) => nodes.filter((n) => n.kind === k);

    // Person root + 2 companies + 1 institution (company kind) + 1 project +
    // 2 experience-anchor nodes (project kind) + skills.
    expect(byKind('person')).toHaveLength(1);
    // Companies: Acme, Globex, MIT (education → company kind) = 3.
    expect(byKind('company')).toHaveLength(3);
    // Skills deduped by key: TypeScript, PostgreSQL, Kubernetes, React, Leadership = 5.
    expect(byKind('skill')).toHaveLength(5);

    // The graph is connected: every node is reachable from the person root.
    const person = nodes.find((n) => n.kind === 'person')!;
    const reached = await service.traverseNeighborhood({
      userId: USER,
      startNodeId: person.id,
      depth: 10,
    });
    expect(reached.nodes.map((n) => n.id).sort()).toEqual(nodes.map((n) => n.id).sort());

    // Sanity: at least the four required relation types exist.
    const allEdges = await service.edgesTouching(USER, nodes.map((n) => n.id));
    const types = new Set(allEdges.map((e) => e.type));
    expect(types.has('worked_at')).toBe(true);
    expect(types.has('demonstrates')).toBe(true);
    expect(types.has('studied_at')).toBe(true);
    expect(types.has('has_skill')).toBe(true);
    // store retained for count-based idempotency assertions elsewhere.
    void store;
  });

  it('is idempotent — re-importing the same profile duplicates NO nodes/edges', async () => {
    const { service, store } = build();

    await service.upsertFromProfile(USER, FIXTURE);
    const nodesAfterFirst = store.countNodes(USER);
    const edgesAfterFirst = store.countEdges(USER);

    // Re-import (fresh cache, as the composition root would do per request).
    service.clearUpsertCache();
    await service.upsertFromProfile(USER, FIXTURE);

    expect(store.countNodes(USER)).toBe(nodesAfterFirst);
    expect(store.countEdges(USER)).toBe(edgesAfterFirst);
  });

  it('idempotent upsert refreshes label/attrs in place (same node id)', async () => {
    const { service } = build();
    await service.upsertFromProfile(USER, FIXTURE);
    const before = (await service.listNodes(USER)).find((n) => n.kind === 'person')!;

    service.clearUpsertCache();
    await service.upsertFromProfile(USER, { ...FIXTURE, personLabel: 'Ada L.' });
    const after = (await service.listNodes(USER)).find((n) => n.kind === 'person')!;

    expect(after.id).toBe(before.id); // same row
    expect(after.label).toBe('Ada L.'); // updated in place
  });
});

describe('GraphMemoryService.traverseNeighborhood', () => {
  it('depth-2 from a skill node returns the expected neighborhood', async () => {
    const { service } = build();
    await service.upsertFromProfile(USER, FIXTURE);

    const nodes = await service.listNodes(USER);
    const typescript = nodes.find((n) => n.kind === 'skill' && n.label === 'TypeScript')!;
    expect(typescript).toBeDefined();

    // Depth-1 from TypeScript: the person (has_skill) + every experience/project
    // anchor that demonstrates it.
    const d1 = await service.traverseNeighborhood({ userId: USER, startNodeId: typescript.id, depth: 1 });
    const d1Labels = new Set(d1.nodes.map((n) => n.label));
    expect(d1Labels.has('TypeScript')).toBe(true);
    expect(d1Labels.has('Ada Lovelace')).toBe(true); // person via has_skill
    expect(d1Labels.has('Senior Engineer at Acme Corp')).toBe(true);
    expect(d1Labels.has('Staff Engineer at Globex')).toBe(true);
    expect(d1Labels.has('Nightscout')).toBe(true);
    // But NOT yet a 2-hop-only node like PostgreSQL (skill of Acme experience only).
    expect(d1Labels.has('PostgreSQL')).toBe(false);

    // Depth-2 expands one more hop: from the experience anchors we reach their
    // OTHER skills (PostgreSQL, Kubernetes, React) and from the person we reach
    // companies + institution + Leadership.
    const d2 = await service.traverseNeighborhood({ userId: USER, startNodeId: typescript.id, depth: 2 });
    const d2Labels = new Set(d2.nodes.map((n) => n.label));
    expect(d2Labels.has('PostgreSQL')).toBe(true);
    expect(d2Labels.has('Kubernetes')).toBe(true);
    expect(d2Labels.has('React')).toBe(true);
    expect(d2Labels.has('Acme Corp')).toBe(true);
    expect(d2Labels.has('Globex')).toBe(true);
    expect(d2Labels.has('MIT')).toBe(true);
    expect(d2Labels.has('Leadership')).toBe(true);

    // Depth-2 strictly grows the frontier vs depth-1.
    expect(d2.nodes.length).toBeGreaterThan(d1.nodes.length);
  });

  it('honors the edge-type allow-list', async () => {
    const { service } = build();
    await service.upsertFromProfile(USER, FIXTURE);
    const person = (await service.listNodes(USER)).find((n) => n.kind === 'person')!;

    // Only follow worked_at — from the person we reach ONLY the companies.
    const worked = await service.traverseNeighborhood({
      userId: USER,
      startNodeId: person.id,
      depth: 3,
      types: ['worked_at'],
    });
    const kinds = new Set(worked.nodes.map((n) => n.kind));
    expect(kinds.has('company')).toBe(true);
    expect(kinds.has('skill')).toBe(false); // has_skill edges were not followed
  });
});

describe('GraphMemoryService.vectorSearch', () => {
  it('ranks nodes by cosine similarity to a query embedding', async () => {
    const { service } = build();
    await service.upsertFromProfile(USER, FIXTURE);

    const embedder = new FakeEmbedder();
    const hits = await service.vectorSearch(USER, embedder.embed('TypeScript'), 3);
    expect(hits.length).toBeGreaterThan(0);
    // The exact-match skill node should be the top hit.
    expect(hits[0]!.node.label).toBe('TypeScript');
    expect(hits[0]!.score).toBeGreaterThan(0);
    // Scores are sorted descending.
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score);
    }
  });
});

describe('GraphMemoryService — per-user scoping', () => {
  it('one user cannot read another user\'s nodes or edges', async () => {
    const { service } = build();
    await service.upsertFromProfile(USER, FIXTURE);
    service.clearUpsertCache();
    await service.upsertFromProfile(OTHER, { ...FIXTURE, profileId: 'profile-B', personLabel: 'Grace Hopper' });

    const aNodes = await service.listNodes(USER);
    const bNodes = await service.listNodes(OTHER);

    // Disjoint node id sets.
    const aIds = new Set(aNodes.map((n) => n.id));
    expect(bNodes.every((n) => !aIds.has(n.id))).toBe(true);

    // User B cannot fetch a User A node by id.
    const aPerson = aNodes.find((n) => n.kind === 'person')!;
    expect(await service.getNode(OTHER, aPerson.id)).toBeNull();

    // Traversal from a User A node is empty when scoped to User B.
    const scoped = await service.traverseNeighborhood({ userId: OTHER, startNodeId: aPerson.id, depth: 3 });
    // The start node itself isn't in B's store, so no edges are returned.
    expect(scoped.edges).toHaveLength(0);
  });
});
