-- M02 memory tier tables (database-schema.md §memory).
-- Additive, expand-only migration: no existing tables/columns are altered, so it
-- is backward-compatible with M01 (migration-policy §5).
--
-- MemoryEvent (episodic) is APPEND-ONLY by application contract — the store
-- exposes only append()/read paths; rows are removed solely by the account
-- hard-delete cascade (ON DELETE CASCADE from users), identical to audit_log.
-- DerivedInsight (semantic) is REGENERABLE — safe to drop/rebuild; cascades from
-- the owning profile.

-- CreateEnum
CREATE TYPE "public"."MemoryEventType" AS ENUM ('twin_action', 'user_decision', 'outcome', 'system');

-- CreateTable
CREATE TABLE "public"."memory_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "public"."MemoryEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "rationale" TEXT,
    "autonomy_tier" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."derived_insights" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "statement" TEXT NOT NULL,
    "source_refs" JSONB NOT NULL,
    "freshness_at" TIMESTAMP(3) NOT NULL,
    "model_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "derived_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memory_events_user_id_occurred_at_idx" ON "public"."memory_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "derived_insights_profile_id_idx" ON "public"."derived_insights"("profile_id");

-- AddForeignKey
ALTER TABLE "public"."memory_events" ADD CONSTRAINT "memory_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."derived_insights" ADD CONSTRAINT "derived_insights_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
