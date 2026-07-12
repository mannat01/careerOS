import { PrismaClient, Prisma } from '@prisma/client';
import type {
  EdgeType,
  GraphEdge,
  GraphEdgeInput,
  GraphNode,
  GraphNodeInput,
  GraphStore,
} from '@careeros/memory';

/**
 * Prisma-backed GraphStore — implements the GraphStore PORT owned by
 * @careeros/memory/graph. This is the ONLY code path that touches the
 * graph_nodes / graph_edges tables.
 *
 * Upsert semantics:
 *   - Nodes deduped on `(userId, kind, key)` — the natural dedupe key that
 *     makes re-import idempotent.
 *   - Edges deduped on `(userId, fromNodeId, toNodeId, type)` — so the same
 *     relationship is never duplicated.
 *
 * PER-USER SCOPING: every query keys on userId at the WHERE clause level.
 *
 * NOTE(embedding): `graph_nodes.embedding` is a pgvector `vector(1536)` column,
 * which Prisma exposes as an Unsupported type — it cannot be written or read via
 * the generated client. The column + hnsw index exist for real-embedding vector
 * search (a later milestone); the STUB(M02) FakeEmbedder vectors are exercised by
 * the in-memory store's `vectorSearch` unit tests. This adapter therefore does
 * NOT persist/return embeddings (reads project them as an empty array).
 */
export class PrismaGraphStore implements GraphStore {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertNode(input: GraphNodeInput): Promise<GraphNode> {
    const kind = input.kind;
    const row = await this.prisma.graphNode.upsert({
      where: { userId_kind_key: { userId: input.userId, kind, key: input.key } },
      create: {
        userId: input.userId,
        kind,
        key: input.key,
        refId: input.refId ?? null,
        label: input.label,
        attrs: (input.attrs ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        label: input.label,
        attrs: (input.attrs ?? {}) as Prisma.InputJsonValue,
        refId: input.refId ?? null,
      },
    });

    return toGraphNode(row);
  }

  async upsertEdge(input: GraphEdgeInput): Promise<GraphEdge> {
    const type = input.type;
    const row = await this.prisma.graphEdge.upsert({
      where: {
        userId_fromNodeId_toNodeId_type: {
          userId: input.userId,
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
          type,
        },
      },
      create: {
        userId: input.userId,
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
        type,
        weight: input.weight ?? 1,
        attrs: (input.attrs ?? {}) as Prisma.InputJsonValue,
        provenance: input.provenance,
      },
      update: {
        weight: input.weight ?? 1,
        attrs: (input.attrs ?? {}) as Prisma.InputJsonValue,
        provenance: input.provenance,
      },
    });

    return toGraphEdge(row);
  }

  async getNode(userId: string, nodeId: string): Promise<GraphNode | null> {
    const row = await this.prisma.graphNode.findFirst({ where: { id: nodeId, userId } });
    return row ? toGraphNode(row) : null;
  }

  async getNodesByIds(userId: string, ids: string[]): Promise<GraphNode[]> {
    const rows = await this.prisma.graphNode.findMany({ where: { id: { in: ids }, userId } });
    return rows.map(toGraphNode);
  }

  async listNodes(userId: string): Promise<GraphNode[]> {
    const rows = await this.prisma.graphNode.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toGraphNode);
  }

  async edgesTouching(
    userId: string,
    nodeIds: string[],
    types?: EdgeType[],
  ): Promise<GraphEdge[]> {
    const where: Prisma.GraphEdgeWhereInput = {
      userId,
      OR: [{ fromNodeId: { in: nodeIds } }, { toNodeId: { in: nodeIds } }],
    };
    if (types && types.length > 0) {
      where.type = { in: types as GraphEdgeType[] };
    }

    const rows = await this.prisma.graphEdge.findMany({ where });
    return rows.map(toGraphEdge);
  }
}

// ---------------- internal helpers ----------------

type GraphEdgeType = Prisma.GraphEdgeGetPayload<Record<string, never>>['type'];

function toGraphNode(row: {
  id: string;
  userId: string;
  kind: string;
  key: string;
  refId: string | null;
  label: string;
  attrs: Prisma.JsonValue;
}): GraphNode {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as GraphNode['kind'],
    key: row.key,
    label: row.label,
    attrs: (row.attrs ?? {}) as Record<string, unknown>,
    embedding: [],
    ...(row.refId !== null ? { refId: row.refId } : {}),
  };
}

function toGraphEdge(row: {
  id: string;
  userId: string;
  fromNodeId: string;
  toNodeId: string;
  type: string;
  weight: number;
  attrs: Prisma.JsonValue;
  provenance: string;
}): GraphEdge {
  return {
    id: row.id,
    userId: row.userId,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    type: row.type as EdgeType,
    weight: row.weight,
    attrs: (row.attrs ?? {}) as Record<string, unknown>,
    provenance: row.provenance,
  };
}
