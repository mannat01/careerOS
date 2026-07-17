-- M06 Stage-6 Step-3 — Strategy Plan tables (database-schema.md §cie).
-- Additive, expand-only migration.
--
-- StrategyPlan persists the Strategy-Planner's grounded per-horizon output. EXACTLY
-- ONE plan per (user, horizon) is `active` at a time — enforced by a PARTIAL unique
-- index below. Adaptive regeneration supersedes the prior active plan (status →
-- superseded, superseded_by_id → new row) and stores the human-readable diff +
-- rationale on the new row. Sub-threshold changes never write a row (anti-thrash).
-- PlanAction carries the laddered, justified actions; the top action of the active
-- 30-day plan is "today's move". Both cascade from the parent User (privacy).

-- CreateEnum
CREATE TYPE "public"."StrategyPlanHorizon" AS ENUM ('d30', 'd90', 'y1', 'y3', 'y5');

-- CreateEnum
CREATE TYPE "public"."StrategyPlanStatus" AS ENUM ('active', 'superseded');

-- CreateEnum
CREATE TYPE "public"."PlanActionKind" AS ENUM ('skill', 'project', 'cert', 'role', 'network', 'other');

-- CreateEnum
CREATE TYPE "public"."PlanActionStatus" AS ENUM ('suggested', 'in_progress', 'done', 'dropped');

-- CreateTable
CREATE TABLE "public"."strategy_plans" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "horizon" "public"."StrategyPlanHorizon" NOT NULL,
    "status" "public"."StrategyPlanStatus" NOT NULL DEFAULT 'active',
    "summary" TEXT NOT NULL,
    "goal_refs" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "diff_summary" TEXT,
    "rationale" TEXT,
    "model_version" TEXT NOT NULL,
    "superseded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategy_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."plan_actions" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "action_key" TEXT NOT NULL,
    "kind" "public"."PlanActionKind" NOT NULL DEFAULT 'other',
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "status" "public"."PlanActionStatus" NOT NULL DEFAULT 'suggested',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "evidence_refs" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "strategy_plans_user_id_horizon_status_idx" ON "public"."strategy_plans"("user_id", "horizon", "status");

-- CreateIndex (PARTIAL unique — at most ONE active plan per (user, horizon))
CREATE UNIQUE INDEX "strategy_plans_user_horizon_active_key" ON "public"."strategy_plans"("user_id", "horizon") WHERE "status" = 'active';

-- CreateIndex
CREATE INDEX "plan_actions_plan_id_order_index_idx" ON "public"."plan_actions"("plan_id", "order_index");

-- AddForeignKey
ALTER TABLE "public"."strategy_plans" ADD CONSTRAINT "strategy_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."strategy_plans" ADD CONSTRAINT "strategy_plans_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."strategy_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."plan_actions" ADD CONSTRAINT "plan_actions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."strategy_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;