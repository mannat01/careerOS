-- M05 Stage-5 Step-5 — Briefing tables (database-schema.md §briefing).
-- Additive, expand-only migration.
--
-- BriefingRun is the audit backbone for a composed briefing: it records per-step
-- status/cost/trace_id and the overall run status. BriefingItem carries the
-- advisory Green artifacts (opportunity/gap/focus/suggestion) each proposed
-- (never executed). Both cascade from the parent User (privacy).

-- CreateEnum
CREATE TYPE "public"."BriefingTrigger" AS ENUM ('scheduled', 'manual');

-- CreateEnum
CREATE TYPE "public"."BriefingStatus" AS ENUM ('queued', 'running', 'partial', 'complete', 'failed');

-- CreateEnum
CREATE TYPE "public"."BriefingItemKind" AS ENUM ('opportunity', 'tailored_resume', 'draft', 'prep', 'gap', 'note', 'focus', 'suggestion');

-- CreateEnum
CREATE TYPE "public"."BriefingItemState" AS ENUM ('proposed', 'approved', 'edited', 'skipped', 'failed');

-- CreateTable
CREATE TABLE "public"."briefing_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "trigger" "public"."BriefingTrigger" NOT NULL,
    "status" "public"."BriefingStatus" NOT NULL DEFAULT 'queued',
    "inputs" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "steps" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "cost_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "briefing_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."briefing_items" (
    "id" UUID NOT NULL,
    "briefing_run_id" UUID NOT NULL,
    "kind" "public"."BriefingItemKind" NOT NULL,
    "ref_id" TEXT,
    "autonomy_tier" TEXT NOT NULL DEFAULT 'green',
    "state" "public"."BriefingItemState" NOT NULL DEFAULT 'proposed',
    "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "briefing_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "briefing_runs_user_id_started_at_idx" ON "public"."briefing_runs"("user_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "briefing_items_briefing_run_id_idx" ON "public"."briefing_items"("briefing_run_id");

-- AddForeignKey
ALTER TABLE "public"."briefing_runs" ADD CONSTRAINT "briefing_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."briefing_items" ADD CONSTRAINT "briefing_items_briefing_run_id_fkey" FOREIGN KEY ("briefing_run_id") REFERENCES "public"."briefing_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;