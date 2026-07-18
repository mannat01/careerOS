-- M07 Step 3 — Research tables (database-schema.md §cie: ResearchSource + ResearchFinding).
-- Additive, expand-only migration. Backward-compatible with all prior milestones.
--
-- ResearchSource extends SourceRegistry semantics for research feeds: an allow-list
-- of sanctioned per-domain research hosts. The guarded research fetch layer blocks
-- any host absent or disabled with `source_not_allowed` — same discipline as the
-- M04 SourceRegistry, in a separate table so per-source policy evolves indepenently.
--
-- ResearchFinding stores normalized findings from sanctioned sources. GLOBAL where
-- market-wide (no user_id); the same normalized signal serves every user, the
-- personalized surfacing lives on the per-user graph edges (evidenced_by) minted by
-- the graph-evidence linker. Idempotent on (source_key, source_ref) — re-ingesting
-- the same fixture upserts in place; no duplicate rows on redelivery.

-- CreateEnum
CREATE TYPE "public"."ResearchFindingDomain" AS ENUM ('hiring', 'salary', 'skills', 'tech', 'certs', 'company', 'industry');

-- CreateTable
CREATE TABLE "public"."research_sources" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "domain" "public"."ResearchFindingDomain" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "hosts" JSONB NOT NULL,
    "rate_policy" JSONB,
    "mapping" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "research_sources_key_key" ON "public"."research_sources"("key");

-- CreateTable
CREATE TABLE "public"."research_findings" (
    "id" UUID NOT NULL,
    "source_key" TEXT NOT NULL,
    "source_ref" TEXT NOT NULL,
    "domain" "public"."ResearchFindingDomain" NOT NULL,
    "summary" TEXT NOT NULL,
    "raw_ref" JSONB NOT NULL,
    "entities" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "strength" TEXT NOT NULL DEFAULT 'medium',
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (dedupe on redelivery — the natural key)
CREATE UNIQUE INDEX "research_findings_source_key_source_ref_key" ON "public"."research_findings"("source_key", "source_ref");

-- CreateIndex (recent-first per-domain listing — the feed's hot path)
CREATE INDEX "research_findings_domain_observed_at_idx" ON "public"."research_findings"("domain", "observed_at" DESC);

-- AddForeignKey
ALTER TABLE "public"."research_findings" ADD CONSTRAINT "research_findings_source_key_fkey" FOREIGN KEY ("source_key") REFERENCES "public"."research_sources"("key") ON DELETE CASCADE ON UPDATE CASCADE;