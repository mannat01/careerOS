-- M02 CIE — Career Knowledge Graph tables (database-schema.md §cie).
-- Additive, expand-only migration: no existing tables/columns are altered, so it
-- is backward-compatible with M01 + M02 memory (migration-policy §5).
--
-- GraphNode: per-user nodes with a natural dedupe key `(user_id, kind, key)` that
-- makes upsert-from-profile idempotent. `embedding` is a pgvector(1536) column for
-- similarity search (hnsw index added below).
-- GraphEdge: typed, directed relationships. Traversal is BIDIRECTIONAL — edges are
-- followable from either endpoint — so both `(user_id, from_node_id, type)` and
-- `(user_id, to_node_id, type)` are indexed.

-- CreateEnum
CREATE TYPE "public"."GraphNodeKind" AS ENUM (
  'person', 'company', 'recruiter', 'interview', 'resume', 'project',
  'certification', 'skill', 'industry', 'application', 'outcome',
  'learning_resource', 'opportunity', 'goal'
);

-- CreateEnum
CREATE TYPE "public"."GraphEdgeType" AS ENUM (
  'worked_at', 'requires_skill', 'has_skill', 'demonstrates',
  'interviewed_with', 'led_to_outcome', 'builds_toward_goal',
  'taught_by', 'competes_with', 'reports_to', 'located_in',
  'targets', 'evidenced_by', 'studied_at'
);

-- CreateTable: graph_nodes
CREATE TABLE "public"."graph_nodes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "public"."GraphNodeKind" NOT NULL,
    "key" TEXT NOT NULL,
    "ref_id" TEXT,
    "label" TEXT NOT NULL,
    "attrs" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "graph_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: graph_edges
CREATE TABLE "public"."graph_edges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "from_node_id" UUID NOT NULL,
    "to_node_id" UUID NOT NULL,
    "type" "public"."GraphEdgeType" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "attrs" JSONB NOT NULL DEFAULT '{}',
    "provenance" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "graph_edges_pkey" PRIMARY KEY ("id")
);

-- Unique constraints for idempotent upsert
CREATE UNIQUE INDEX "graph_nodes_user_id_kind_key_key" ON "public"."graph_nodes"("user_id", "kind", "key");
CREATE UNIQUE INDEX "graph_edges_user_id_from_node_id_to_node_id_type_key" ON "public"."graph_edges"("user_id", "from_node_id", "to_node_id", "type");

-- Indexes: per-user scoping + kind filter
CREATE INDEX "graph_nodes_user_id_kind_idx" ON "public"."graph_nodes"("user_id", "kind");

-- Bidirectional edge traversal indexes (database-schema.md §3 CIE)
CREATE INDEX "graph_edges_user_id_from_node_id_type_idx" ON "public"."graph_edges"("user_id", "from_node_id", "type");
CREATE INDEX "graph_edges_user_id_to_node_id_type_idx" ON "public"."graph_edges"("user_id", "to_node_id", "type");

-- hnsw index on node embedding for vector similarity search
CREATE INDEX "graph_nodes_embedding_idx" ON "public"."graph_nodes" USING hnsw ("embedding" vector_cosine_ops);

-- Foreign keys
ALTER TABLE "public"."graph_nodes" ADD CONSTRAINT "graph_nodes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."graph_edges" ADD CONSTRAINT "graph_edges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."graph_edges" ADD CONSTRAINT "graph_edges_from_node_id_fkey" FOREIGN KEY ("from_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."graph_edges" ADD CONSTRAINT "graph_edges_to_node_id_fkey" FOREIGN KEY ("to_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
