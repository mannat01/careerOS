import type { Embedder } from '../src/embedder.js';
import { cosineSimilarity } from '../src/embedder.js';
import type {
  EdgeType,
  GraphEdge,
  GraphNode,
  GraphProfileInput,
  GraphStore,
  NeighborhoodQuery,
  NodeHit,
  Subgraph,
} from './types.js';

/**
 * GraphMemoryService — the Career Knowledge Graph (database-schema.md §cie).
 * This is the SINGLE interface agents (and the API) call for graph access; only
 * this class touches the GraphStore port (whose in-memory fake and Prisma-backed
 * adapter live in memory/graph and @careeros/db respectively). Agents must never
 * import @careeros/db directly — enforced by the agentBoundary lint overlay.
 *
 * Capabilities:
 *  - **upsertFromProfile**: turn extracted entities into a connected property
 *    graph — person (root) → company (worked_at), experience → skill
 *    (demonstrates), project → skill (demonstrates), education → institution
 *    (studied_at). Idempotent: re-import maps the same natural keys to existing
 *    rows, so no duplicate nodes/edges are created.
 *  - **traverseNeighborhood**: multi-hop BFS from a start node, optionally
 *    filtered by edge type, returning the visited (sub)graph.
 *  - **vectorSearch**: cosine-similarity ranked node hits for a query text.
 */
export class GraphMemoryService {
  constructor(
    private readonly store: GraphStore,
    private readonly embedder: Embedder,
  ) {}

  // ---------------- upsert from profile (idempotent) ----------------

  /**
   * Turn a user's extracted entities into the Career Knowledge Graph. Creates
   * (or re-maps, if the same key already exists):
   *
   *   person (root) ──worked_at──→ company
   *   experience ──demonstrates──→ skill
   *   project ──demonstrates──→ skill
   *   person ──studied_at──→ institution
   *   person ──has_skill──→ skill
   *
   * Idempotent: the natural keys are `(userId, kind, key)` for nodes and
   * `(userId, from, to, type)` for edges, so re-importing the same profile
   * updates labels/embeddings in place and never duplicates rows.
   */
  async upsertFromProfile(userId: string, input: GraphProfileInput): Promise<void> {
    // 1. Person (root) node.
    const person = await this.store.upsertNode({
      userId,
      kind: 'person',
      key: 'person',
      label: input.personLabel ?? 'You',
      refId: input.profileId,
      attrs: { profileId: input.profileId },
      embedding: this.embedder.embed(input.personLabel ?? 'You'),
    });

    // 2. Experience → company (worked_at) + experience → skill (demonstrates)
    for (const exp of input.experiences) {
      // Company node
      const company = await this.store.upsertNode({
        userId,
        kind: 'company',
        key: `company:${exp.company.toLowerCase().trim()}`,
        label: exp.company,
        attrs: { ref: exp.ref },
        embedding: this.embedder.embed(exp.company),
      });

      // Edge: person → company (worked_at)
      await this.store.upsertEdge({
        userId,
        fromNodeId: person.id,
        toNodeId: company.id,
        type: 'worked_at',
        weight: 1,
        attrs: { title: exp.title ?? '', ref: exp.ref },
        provenance: 'profile_import',
      });

      // Experience node (to anchor demonstrates edges)
      const expKey = `experience:${exp.company.toLowerCase().trim()}:${(exp.title ?? '').toLowerCase().trim()}`;
      const expLabel = `${exp.title ?? 'Role'} at ${exp.company}`;
      const expNode = await this.store.upsertNode({
        userId,
        kind: 'project',
        key: expKey,
        label: expLabel,
        attrs: { ref: exp.ref, company: exp.company, title: exp.title },
        embedding: this.embedder.embed(expLabel),
      });

      // Edge: experience → skill (demonstrates)
      for (const skillName of exp.skills ?? []) {
        const skill = await this.upsertSkillNode(userId, skillName, exp.ref);
        await this.store.upsertEdge({
          userId,
          fromNodeId: expNode.id,
          toNodeId: skill.node.id,
          type: 'demonstrates',
          weight: 1,
          attrs: { ref: exp.ref },
          provenance: 'profile_import',
        });
      }
    }

    // 3. Project → skill (demonstrates)
    for (const proj of input.projects) {
      const projNode = await this.store.upsertNode({
        userId,
        kind: 'project',
        key: `project:${proj.name.toLowerCase().trim()}`,
        label: proj.name,
        attrs: { ref: proj.ref },
        embedding: this.embedder.embed(proj.name),
      });

      for (const skillName of proj.skills ?? []) {
        const skill = await this.upsertSkillNode(userId, skillName, proj.ref);
        await this.store.upsertEdge({
          userId,
          fromNodeId: projNode.id,
          toNodeId: skill.node.id,
          type: 'demonstrates',
          weight: 1,
          attrs: { ref: proj.ref },
          provenance: 'profile_import',
        });
      }
    }

    // 4. Education → institution (studied_at)
    for (const edu of input.education) {
      const institution = await this.store.upsertNode({
        userId,
        kind: 'company',
        key: `company:${edu.institution.toLowerCase().trim()}`,
        label: edu.institution,
        attrs: { ref: edu.ref },
        embedding: this.embedder.embed(edu.institution),
      });

      await this.store.upsertEdge({
        userId,
        fromNodeId: person.id,
        toNodeId: institution.id,
        type: 'studied_at',
        weight: 1,
        attrs: { credential: edu.credential ?? '', field: edu.field ?? '', ref: edu.ref },
        provenance: 'profile_import',
      });
    }

    // 5. Person → skill (has_skill) for top-level skills
    for (const sk of input.skills) {
      const skill = await this.upsertSkillNode(userId, sk.name, sk.ref);
      await this.store.upsertEdge({
        userId,
        fromNodeId: person.id,
        toNodeId: skill.node.id,
        type: 'has_skill',
        weight: 1,
        attrs: { ref: sk.ref },
        provenance: 'profile_import',
      });
    }
  }

  // ---------------- opportunity → company + required-skill (M04 ingestion) ----------------

  /**
   * Idempotent upsert of the subgraph produced by ingesting one Opportunity
   * into the per-user Career Knowledge Graph (milestone-04 §Deliverables):
   *
   *   opportunity ──about_company──→ company
   *   opportunity ──requires_skill──→ skill (one edge per required skill)
   *
   * The opportunity node key is the row id from the OpportunityStore — that's
   * a UUID, stable across ingestion runs — so re-ingesting the SAME opportunity
   * updates the node in place and never creates duplicate edges. Company +
   * skill node keys are canonicalized on lower-cased trimmed labels (the same
   * conventions used by `upsertFromProfile` above), so the ingested company
   * and a company already imported from the user's profile share ONE node —
   * which is what unlocks skill-overlap scoring in the next M04 step.
   *
   * PORT match: this method's signature is a structural implementation of
   * `OpportunityGraphSink` in @careeros/connectors (the `IngestionService`
   * accepts it via duck-typing so `memory` doesn't need to import
   * `@careeros/connectors`).
   */
  async upsertOpportunityGraph(
    userId: string,
    input: {
      opportunityId: string;
      role: string;
      company: string;
      requiredSkills: readonly string[];
    },
  ): Promise<void> {
    // 1. Opportunity node — kind='project' (there's no dedicated 'opportunity'
    // GraphNodeKind in the M02 enum; project is the closest 'thing you might
    // work on' shape and is what agents already reason about in vector search).
    const oppLabel = `${input.role} at ${input.company}`;
    const opportunityNode = await this.store.upsertNode({
      userId,
      kind: 'project',
      key: `opportunity:${input.opportunityId}`,
      label: oppLabel,
      refId: input.opportunityId,
      attrs: { opportunityId: input.opportunityId, role: input.role, company: input.company },
      embedding: this.embedder.embed(oppLabel),
    });

    // 2. Company node (shared with profile-import companies via identical key).
    const company = await this.store.upsertNode({
      userId,
      kind: 'company',
      key: `company:${input.company.toLowerCase().trim()}`,
      label: input.company,
      attrs: { source: 'opportunity_ingest' },
      embedding: this.embedder.embed(input.company),
    });

    // 3. Edge: opportunity → company. We reuse the `worked_at` edge type; the
    // M02 GraphEdgeType enum was scoped to profile relations and adding a new
    // enum value here would ripple through the DB migration and every
    // agentBoundary matcher for zero graph-shape benefit — the traversal API
    // filters by node.kind anyway.
    await this.store.upsertEdge({
      userId,
      fromNodeId: opportunityNode.id,
      toNodeId: company.id,
      type: 'worked_at',
      weight: 1,
      attrs: { relation: 'about_company', opportunityId: input.opportunityId },
      provenance: 'opportunity_ingest',
    });

    // 4. Edges: opportunity → each required skill (demonstrates ≈ requires).
    for (const skillName of input.requiredSkills) {
      const skill = await this.upsertSkillNode(userId, skillName, input.opportunityId);
      await this.store.upsertEdge({
        userId,
        fromNodeId: opportunityNode.id,
        toNodeId: skill.node.id,
        type: 'demonstrates',
        weight: 1,
        attrs: { relation: 'requires_skill', opportunityId: input.opportunityId },
        provenance: 'opportunity_ingest',
      });
    }
  }

  // ---------------- per-call skill cache (avoids redundant upsertNode lookups) ----------------


  private skillCache = new Map<string, { node: GraphNode }>();

  private async upsertSkillNode(
    userId: string,
    name: string,
    ref?: string,
  ): Promise<{ node: GraphNode }> {
    const key = `skill:${name.toLowerCase().trim()}`;
    const cacheKey = `${userId}::${key}`;
    const cached = this.skillCache.get(cacheKey);
    if (cached) return cached;

    const node = await this.store.upsertNode({
      userId,
      kind: 'skill',
      key,
      label: name,
      attrs: { ref },
      embedding: this.embedder.embed(name),
    });
    const result = { node };
    this.skillCache.set(cacheKey, result);
    return result;
  }

  /** Clear the per-call upsert cache. Call between independent upsertFromProfile calls. */
  clearUpsertCache(): void {
    this.skillCache.clear();
  }

  // ---------------- neighborhood traversal (BFS) ----------------

  /**
   * BFS traversal from `startNodeId` up to `depth` hops. Returns the visited
   * subgraph: all nodes reached + every edge traversed to reach them. PER-USER
   * scoped (the store guarantees no cross-user leakage).
   */
  async traverseNeighborhood(query: NeighborhoodQuery & { userId: string }): Promise<Subgraph> {
    const depth = Math.max(1, query.depth);
    const visited = new Set<string>([query.startNodeId]);
    const frontier = new Set<string>([query.startNodeId]);
    const edgeMap = new Map<string, GraphEdge>();

    for (let hop = 0; hop < depth && frontier.size > 0; hop++) {
      const current = [...frontier];
      frontier.clear();

      const edges = await this.store.edgesTouching(query.userId, current, query.types);
      for (const edge of edges) {
        edgeMap.set(edge.id, edge);
        const neighbor =
          edge.fromNodeId === edge.toNodeId
            ? edge.fromNodeId
            : visited.has(edge.fromNodeId)
              ? edge.toNodeId
              : edge.fromNodeId;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          frontier.add(neighbor);
        }
      }
    }

    const nodes = await this.store.getNodesByIds(query.userId, [...visited]);
    return { nodes, edges: [...edgeMap.values()] };
  }

  // ---------------- vector node retrieval ----------------

  /**
   * Find the top-N nodes by cosine similarity to `queryEmbedding`. PER-USER
   * scoped. Returns nodes sorted by descending score.
   */
  async vectorSearch(
    userId: string,
    queryEmbedding: number[],
    topN: number,
  ): Promise<NodeHit[]> {
    const all = await this.store.listNodes(userId);
    const scored: NodeHit[] = all.map((node) => ({
      node,
      score: cosineSimilarity(queryEmbedding, node.embedding),
    }));
    scored.sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
    return scored.slice(0, topN);
  }

  // ---------------- convenience accessors ----------------

  /** Get a single node by id (per-user scoped). */
  async getNode(userId: string, nodeId: string): Promise<GraphNode | null> {
    return this.store.getNode(userId, nodeId);
  }

  /** List all nodes for a user. */
  async listNodes(userId: string): Promise<GraphNode[]> {
    return this.store.listNodes(userId);
  }

  /** List edges touching any of `nodeIds`, optionally filtered by type. */
  async edgesTouching(
    userId: string,
    nodeIds: string[],
    types?: EdgeType[],
  ): Promise<GraphEdge[]> {
    return this.store.edgesTouching(userId, nodeIds, types);
  }
}
