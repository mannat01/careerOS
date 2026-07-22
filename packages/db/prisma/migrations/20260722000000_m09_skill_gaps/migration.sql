-- M09 Step 3 — Skill Development (database-schema.md §cie).
-- SkillGap: Profile 1:N SkillGap — deterministic demanded-but-missing skills
--   (per_opp from match subscores; aggregate from low-confidence/absent state
--   dimensions against stated target roles).
-- LearningItem: SkillGap 1:N LearningItem — recommendations with progress.
-- Cross-user isolation via profile_id FK + cascade; a LearningItem cannot
-- exist without a real gap (FK + guardrail).

CREATE TYPE "SkillGapSource" AS ENUM ('per_opp', 'aggregate');
CREATE TYPE "LearningItemStatus" AS ENUM ('suggested', 'in_progress', 'done');

CREATE TABLE "skill_gaps" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "skill" TEXT NOT NULL,
    "gap" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "source" "SkillGapSource" NOT NULL,
    "evidence_refs" JSONB NOT NULL DEFAULT '[]',
    "model_version" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_gaps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "learning_items" (
    "id" UUID NOT NULL,
    "skill_gap_id" UUID NOT NULL,
    "resource" JSONB NOT NULL,
    "status" "LearningItemStatus" NOT NULL DEFAULT 'suggested',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "skill_gaps_profile_id_skill_source_opportunity_id_key"
    ON "skill_gaps"("profile_id", "skill", "source", "opportunity_id");

CREATE INDEX "skill_gaps_profile_id_computed_at_idx"
    ON "skill_gaps"("profile_id", "computed_at" DESC);

CREATE INDEX "learning_items_skill_gap_id_idx"
    ON "learning_items"("skill_gap_id");

ALTER TABLE "skill_gaps" ADD CONSTRAINT "skill_gaps_profile_id_fkey"
    FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "learning_items" ADD CONSTRAINT "learning_items_skill_gap_id_fkey"
    FOREIGN KEY ("skill_gap_id") REFERENCES "skill_gaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;