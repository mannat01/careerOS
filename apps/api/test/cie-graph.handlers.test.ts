/**
 * DB-free unit tests for the GET /v1/cie/graph handler. Exercises the pure
 * handler against a fake GraphQueryPort — no Nest, no Postgres. Locks the things
 * the e2e can't cheaply prove per-branch:
 *  - per-user scoping (userId comes ONLY from the verified context),
 *  - the two read paths (listing when no node param; neighborhood when node set),
 *  - unknown node → 404, and depth/type query-param parsing.
 */
import { describe, expect, it } from 'vitest';
import {
  contextFromVerifiedClaims,
  queryGraph,
  type GraphQueryPort,
  type RequestContext,
} from '../src/index.js';
import type { GraphNode, Subgraph } from '@careeros/memory';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const ctx = (userId: string): RequestContext =>
  contextFromVerifiedClaims({ userId, traceId: 'trace-1' });

function node(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    userId: USER_A,
    kind: 'skill',
    key: `skill:${id}`,
    label: id,
    attrs: {},
    embedding: [],
    ...over,
  };
}

/** A fake port that records the calls it received and returns canned data. */
class FakeGraphPort implements GraphQueryPort {
  calls: { method: string; args: unknown }[] = [];
  constructor(
    private readonly nodes: GraphNode[],
    private readonly subgraph: Subgraph,
  ) {}

  getNode(userId: string, nodeId: string): Promise<GraphNode | null> {
    this.calls.push({ method: 'getNode', args: { userId, nodeId } });
    return Promise.resolve(this.nodes.find((n) => n.id === nodeId && n.userId === userId) ?? null);
  }

  traverseNeighborhood(query: {
    userId: string;
    startNodeId: string;
    depth: number;
    types?: string[];
  }): Promise<Subgraph> {
    this.calls.push({ method: 'traverseNeighborhood', args: query });
    return Promise.resolve(this.subgraph);
  }

  listNodes(userId: string): Promise<GraphNode[]> {
    this.calls.push({ method: 'listNodes', args: { userId } });
    return Promise.resolve(this.nodes.filter((n) => n.userId === userId));
  }
}

describe('GET /v1/cie/graph handler', () => {
  it('lists all nodes when no node param is given', async () => {
    const port = new FakeGraphPort([node('a'), node('b')], { nodes: [], edges: [] });
    const res = await queryGraph(ctx(USER_A), {}, { graph: port });

    expect(res.status).toBe(200);
    const bodyOut = res.body as { nodes: GraphNode[]; edges: unknown[] };
    expect(bodyOut.nodes).toHaveLength(2);
    expect(bodyOut.edges).toHaveLength(0);
    expect(port.calls.some((c) => c.method === 'listNodes')).toBe(true);
    // Scoped to the verified user.
    expect(port.calls[0]!.args).toEqual({ userId: USER_A });
  });

  it('returns the neighborhood when a node param is given', async () => {
    const start = node('ts', { label: 'TypeScript' });
    const neighbor = node('pg', { label: 'PostgreSQL' });
    const port = new FakeGraphPort([start, neighbor], {
      nodes: [start, neighbor],
      edges: [
        {
          id: 'e1',
          userId: USER_A,
          fromNodeId: 'ts',
          toNodeId: 'pg',
          type: 'demonstrates',
          weight: 1,
          attrs: {},
          provenance: 'profile_import',
        },
      ],
    });

    const res = await queryGraph(ctx(USER_A), { node: 'ts', depth: '2' }, { graph: port });
    expect(res.status).toBe(200);
    const bodyOut = res.body as { nodes: GraphNode[]; edges: Array<{ type: string }> };
    expect(bodyOut.nodes.map((n) => n.label).sort()).toEqual(['PostgreSQL', 'TypeScript']);
    expect(bodyOut.edges[0]!.type).toBe('demonstrates');

    // Depth parsed to a number; user scoped from the context.
    const traversal = port.calls.find((c) => c.method === 'traverseNeighborhood')!;
    expect(traversal.args).toMatchObject({ userId: USER_A, startNodeId: 'ts', depth: 2 });
  });

  it('parses a comma-separated types allow-list', async () => {
    const start = node('ts');
    const port = new FakeGraphPort([start], { nodes: [start], edges: [] });
    await queryGraph(ctx(USER_A), { node: 'ts', types: 'worked_at, demonstrates' }, { graph: port });

    const traversal = port.calls.find((c) => c.method === 'traverseNeighborhood')!;
    expect(traversal.args).toMatchObject({ types: ['worked_at', 'demonstrates'] });
  });

  it('defaults depth to 1 and clamps sub-1 values', async () => {
    const start = node('ts');
    const port = new FakeGraphPort([start], { nodes: [start], edges: [] });
    await queryGraph(ctx(USER_A), { node: 'ts', depth: '0' }, { graph: port });

    const traversal = port.calls.find((c) => c.method === 'traverseNeighborhood')!;
    expect(traversal.args).toMatchObject({ depth: 1 });
  });

  it('returns 404 for an unknown node (also the cross-user case)', async () => {
    const port = new FakeGraphPort([], { nodes: [], edges: [] });
    const res = await queryGraph(ctx(USER_A), { node: 'does-not-exist' }, { graph: port });
    expect(res.status).toBe(404);
    // Never attempts a traversal for a node the user can't see.
    expect(port.calls.some((c) => c.method === 'traverseNeighborhood')).toBe(false);
  });
});
