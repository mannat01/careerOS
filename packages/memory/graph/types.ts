/**
 * @careeros/memory/graph — the Career Knowledge Graph domain types + the store
 * PORT the GraphMemoryService depends on (database-schema.md §cie GraphNode/
 * GraphEdge). Concrete Prisma-backed adapters live in @careeros/db and implement
 * `GraphStore`, so the dependency arrow points INTO memory (never out to
 * @careeros/db) — the same inversion as the four memory tiers. Agents reach the
 * graph ONLY through GraphMemoryService.
 */

// ---------------- node kinds + edge types (database-schema.md §cie) ----------------

/**
 * GraphNode.kind — the fixed enum from database-schema.md §cie. The migration's
 * `GraphNodeKind` enum is the source of truth; this mirrors it 1:1.
 */
export const NODE_KINDS = [
  'person',
  'company',
  'recruiter',
  'interview',
  'resume',
  'project',
  'certification',
  'skill',
  'industry',
  'application',
  'outcome',
  'learning_resource',
  'opportunity',
  'goal',
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/**
 * GraphEdge.type — the typed relationship enum from database-schema.md §cie
 * (which ends with `…`, i.e. extensible). `studied_at` is the education→
 * institution relation added under that extensibility.
 */
export const EDGE_TYPES = [
  'worked_at',
  'requires_skill',
  'has_skill',
  'demonstrates',
  'interviewed_with',
  'led_to_outcome',
  'builds_toward_goal',
  'taught_by',
  'competes_with',
  'reports_to',
  'located_in',
  'targets',
  'evidenced_by',
  'studied_at',
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

// ---------------- node + edge shapes ----------------

/**
 * A Career Knowledge Graph node. `key` is the per-user natural dedupe key
 * (e.g. `company:acme corp`) that makes upsert-from-profile idempotent — a
 * re-import maps to the SAME key and updates in place rather than duplicating.
 * `refId` points back at the owning domain row when one exists (nullable).
 * `embedding` is the node's vector (deterministic FakeEmbedder in tests).
 */
export interface GraphNode {
  id: string;
  userId: string;
  kind: NodeKind;
  key: string;
  refId?: string;
  label: string;
  attrs: Record<string, unknown>;
  /** May be empty when a store projection omits it (e.g. traversal reads). */
  embedding: number[];
}

/**
 * A typed, directed relationship. Traversal is BIDIRECTIONAL — an edge is
 * followable from either endpoint — so `(userId, from, type)` and
 * `(userId, to, type)` are both indexed (database-schema.md §3 CIE).
 */
export interface GraphEdge {
  id: string;
  userId: string;
  fromNodeId: string;
  toNodeId: string;
  type: EdgeType;
  weight: number;
  attrs: Record<string, unknown>;
  provenance: string;
}

export interface GraphNodeInput {
  userId: string;
  kind: NodeKind;
  key: string;
  refId?: string;
  label: string;
  attrs?: Record<string, unknown>;
  embedding: number[];
}

export interface GraphEdgeInput {
  userId: string;
  fromNodeId: string;
  toNodeId: string;
  type: EdgeType;
  weight?: number;
  attrs?: Record<string, unknown>;
  provenance: string;
}

// ---------------- store PORT (owned by memory, implemented in db) ----------------

/**
 * The graph store PORT. Every method is PER-USER scoped: the `userId` is the
 * only row-scope key, so one user's traversal can never surface another user's
 * nodes/edges. `upsertNode`/`upsertEdge` are idempotent on the natural keys
 * (`(userId, kind, key)` for nodes, `(userId, from, to, type)` for edges).
 */
export interface GraphStore {
  upsertNode(input: GraphNodeInput): Promise<GraphNode>;
  upsertEdge(input: GraphEdgeInput): Promise<GraphEdge>;
  getNode(userId: string, nodeId: string): Promise<GraphNode | null>;
  getNodesByIds(userId: string, ids: string[]): Promise<GraphNode[]>;
  listNodes(userId: string): Promise<GraphNode[]>;
  /** Every edge touching ANY of `nodeIds` (either endpoint), optionally filtered by type. */
  edgesTouching(userId: string, nodeIds: string[], types?: EdgeType[]): Promise<GraphEdge[]>;
}

// ---------------- upsert-from-profile input ----------------

/**
 * The extracted-entity projection the graph is built from. It is intentionally
 * decoupled from @careeros/contracts' ParsedEntity so the memory package stays
 * free of the contracts dependency — the app-layer adapter maps one to the other.
 */
export interface GraphProfileInput {
  /** Owning profile row id, stamped onto the person (root) node's refId when present. */
  profileId?: string;
  /** Label for the person (root) node; defaults to "You". */
  personLabel?: string;
  experiences: Array<{ ref?: string; company: string; title?: string; skills?: string[] }>;
  projects: Array<{ ref?: string; name: string; skills?: string[] }>;
  education: Array<{ ref?: string; institution: string; credential?: string; field?: string }>;
  skills: Array<{ ref?: string; name: string }>;
}

// ---------------- traversal + retrieval results ----------------

/** A connected slice of the graph: the visited nodes + the edges traversed. */
export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface NeighborhoodQuery {
  startNodeId: string;
  /** Hop radius (BFS). Callers clamp; the service treats <1 as 1. */
  depth: number;
  /** Optional edge-type allow-list for the traversal. */
  types?: EdgeType[];
}

/** One vector-retrieval hit: a node + its cosine similarity to the query. */
export interface NodeHit {
  node: GraphNode;
  score: number;
}
