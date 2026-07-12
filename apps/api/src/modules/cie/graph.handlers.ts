import { EDGE_TYPES, type GraphMemoryService, type Subgraph, type GraphNode, type EdgeType } from '@careeros/memory';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';

/**
 * Graph query port — the handler depends on this narrow interface, not on
 * GraphMemoryService directly, so it stays a pure DB-free function under test.
 */
export interface GraphQueryPort {
  getNode(userId: string, nodeId: string): Promise<GraphNode | null>;
  traverseNeighborhood(query: {
    userId: string;
    startNodeId: string;
    depth: number;
    types?: string[];
  }): Promise<Subgraph>;
  listNodes(userId: string): Promise<GraphNode[]>;
}

/**
 * Adapter that binds the narrow GraphQueryPort to the full GraphMemoryService.
 */
export class GraphMemoryServiceAdapter implements GraphQueryPort {
  constructor(private readonly graph: GraphMemoryService) {}

  getNode(userId: string, nodeId: string): Promise<GraphNode | null> {
    return this.graph.getNode(userId, nodeId);
  }

  traverseNeighborhood(query: {
    userId: string;
    startNodeId: string;
    depth: number;
    types?: string[];
  }): Promise<Subgraph> {
    // Narrow the raw string allow-list to the known EdgeType union; drop anything
    // that isn't a real edge type so the traversal never sees an invalid filter.
    const known = new Set<string>(EDGE_TYPES);
    const types = query.types?.filter((t): t is EdgeType => known.has(t));
    return this.graph.traverseNeighborhood({
      userId: query.userId,
      startNodeId: query.startNodeId,
      depth: query.depth,
      ...(types ? { types } : {}),
    });
  }

  listNodes(userId: string): Promise<GraphNode[]> {
    return this.graph.listNodes(userId);
  }
}

export interface GraphQueryDeps {
  graph: GraphQueryPort;
}

export interface GraphQueryResponse {
  nodes: GraphNode[];
  edges: Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    type: string;
    weight: number;
    provenance: string;
  }>;
}

/**
 * GET /v1/cie/graph — query the Career Knowledge Graph.
 * Query params:
 *   - node (optional): start node id. If omitted, returns all nodes.
 *   - depth (optional, default 1): BFS hop radius.
 *   - types (optional, comma-separated): edge type allow-list.
 *
 * PER-USER SCOPED: the userId comes ONLY from the verified RequestContext.
 */
export async function queryGraph(
  ctx: RequestContext,
  query: { node?: string; depth?: string; types?: string },
  deps: GraphQueryDeps,
): Promise<HandlerResponse<GraphQueryResponse>> {
  if (query.node) {
    const depth = Math.max(1, Number(query.depth) || 1);
    const types = query.types
      ? query.types.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;

    const startNode = await deps.graph.getNode(ctx.userId, query.node);
    if (!startNode) {
      return errorResponse('not_found', 'Node not found.', { details: { nodeId: query.node }, traceId: ctx.traceId });
    }

    const subgraph = await deps.graph.traverseNeighborhood({
      userId: ctx.userId,
      startNodeId: query.node,
      depth,
      types,
    });

    return ok({
      nodes: subgraph.nodes,
      edges: subgraph.edges.map((e) => ({
        id: e.id,
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
        type: e.type,
        weight: e.weight,
        provenance: e.provenance,
      })),
    });
  }

  // No node specified: return all nodes (no edges).
  const nodes = await deps.graph.listNodes(ctx.userId);
  return ok({ nodes, edges: [] });
}
