/**
 * @careeros/memory/graph — barrel exports for the Career Knowledge Graph.
 * Importers rely on this single entry point rather than individual modules.
 */
export { GraphMemoryService } from './service.js';
export { InMemoryGraphStore } from './fake-store.js';
export type {
  GraphNode,
  GraphNodeInput,
  GraphEdge,
  GraphEdgeInput,
  GraphStore,
  GraphProfileInput,
  Subgraph,
  NeighborhoodQuery,
  NodeHit,
  NodeKind,
  EdgeType,
} from './types.js';
export { NODE_KINDS, EDGE_TYPES } from './types.js';
