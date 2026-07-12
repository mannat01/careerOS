import type {
  EdgeType,
  GraphEdge,
  GraphEdgeInput,
  GraphNode,
  GraphNodeInput,
  GraphStore,
} from './types.js';

/**
 * In-memory GraphStore — the DB-free double used by unit tests AND by any caller
 * that wants a non-persistent graph. It encodes the SAME contracts the Prisma
 * adapter must honor:
 *   - PER-USER scoped: every read/write keys on userId; one user's nodes/edges are
 *     never visible to another (the e2e scoping guarantee, proven here in-process).
 *   - IDEMPOTENT upsert: a node is deduped on `(userId, kind, key)` and an edge on
 *     `(userId, from, to, type)`, so re-importing the same profile updates in place
 *     and never duplicates rows.
 */
export class InMemoryGraphStore implements GraphStore {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private seq = 0;

  private nextId(prefix: string): string {
    return `${prefix}-${(++this.seq).toString().padStart(6, '0')}`;
  }

  private static nodeKey(userId: string, kind: string, key: string): string {
    return `${userId}::${kind}::${key}`;
  }

  private static edgeKey(
    userId: string,
    from: string,
    to: string,
    type: string,
  ): string {
    return `${userId}::${from}::${to}::${type}`;
  }

  upsertNode(input: GraphNodeInput): Promise<GraphNode> {
    const dedupe = InMemoryGraphStore.nodeKey(input.userId, input.kind, input.key);
    const existing = [...this.nodes.values()].find(
      (n) => InMemoryGraphStore.nodeKey(n.userId, n.kind, n.key) === dedupe,
    );
    if (existing) {
      // Update in place — same row, refreshed label/attrs/embedding/refId.
      const updated: GraphNode = {
        ...existing,
        label: input.label,
        attrs: { ...(input.attrs ?? {}) },
        embedding: [...input.embedding],
        ...(input.refId !== undefined ? { refId: input.refId } : {}),
      };
      this.nodes.set(existing.id, updated);
      return Promise.resolve({ ...updated });
    }
    const node: GraphNode = {
      id: this.nextId('gn'),
      userId: input.userId,
      kind: input.kind,
      key: input.key,
      label: input.label,
      attrs: { ...(input.attrs ?? {}) },
      embedding: [...input.embedding],
      ...(input.refId !== undefined ? { refId: input.refId } : {}),
    };
    this.nodes.set(node.id, node);
    return Promise.resolve({ ...node });
  }

  upsertEdge(input: GraphEdgeInput): Promise<GraphEdge> {
    const dedupe = InMemoryGraphStore.edgeKey(
      input.userId,
      input.fromNodeId,
      input.toNodeId,
      input.type,
    );
    const existing = [...this.edges.values()].find(
      (e) =>
        InMemoryGraphStore.edgeKey(e.userId, e.fromNodeId, e.toNodeId, e.type) === dedupe,
    );
    if (existing) {
      const updated: GraphEdge = {
        ...existing,
        weight: input.weight ?? existing.weight,
        attrs: { ...(input.attrs ?? {}) },
        provenance: input.provenance,
      };
      this.edges.set(existing.id, updated);
      return Promise.resolve({ ...updated });
    }
    const edge: GraphEdge = {
      id: this.nextId('ge'),
      userId: input.userId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      type: input.type,
      weight: input.weight ?? 1,
      attrs: { ...(input.attrs ?? {}) },
      provenance: input.provenance,
    };
    this.edges.set(edge.id, edge);
    return Promise.resolve({ ...edge });
  }

  getNode(userId: string, nodeId: string): Promise<GraphNode | null> {
    const n = this.nodes.get(nodeId);
    return Promise.resolve(n && n.userId === userId ? { ...n } : null);
  }

  getNodesByIds(userId: string, ids: string[]): Promise<GraphNode[]> {
    const set = new Set(ids);
    return Promise.resolve(
      [...this.nodes.values()]
        .filter((n) => n.userId === userId && set.has(n.id))
        .map((n) => ({ ...n })),
    );
  }

  listNodes(userId: string): Promise<GraphNode[]> {
    return Promise.resolve(
      [...this.nodes.values()].filter((n) => n.userId === userId).map((n) => ({ ...n })),
    );
  }

  edgesTouching(
    userId: string,
    nodeIds: string[],
    types?: EdgeType[],
  ): Promise<GraphEdge[]> {
    const set = new Set(nodeIds);
    const typeSet = types && types.length > 0 ? new Set<EdgeType>(types) : null;
    return Promise.resolve(
      [...this.edges.values()]
        .filter(
          (e) =>
            e.userId === userId &&
            (set.has(e.fromNodeId) || set.has(e.toNodeId)) &&
            (typeSet === null || typeSet.has(e.type)),
        )
        .map((e) => ({ ...e })),
    );
  }

  /** Test-only introspection; NOT part of GraphStore. */
  countNodes(userId: string): number {
    return [...this.nodes.values()].filter((n) => n.userId === userId).length;
  }

  /** Test-only introspection; NOT part of GraphStore. */
  countEdges(userId: string): number {
    return [...this.edges.values()].filter((e) => e.userId === userId).length;
  }
}
