-- M04 opportunity — MatchScore table (database-schema.md §opportunity).
-- Additive, expand-only migration: no existing tables/columns are altered, so it
-- is backward-compatible with M01/M02 (migration-policy §5).
--
-- A discovery-time (profile, opportunity) MatchScore: the scorer's honest, grounded
-- output — `overall` (0–100) + `subscores` (jsonb) + a plain-language `explanation`
-- (never a bare number) + `evidence_refs` (jsonb) + a `model_version` stamp.
--
-- UNIQUE (profile_id, opportunity_id, model_version): 1:many OVER model versions
-- (each version a reproducible row for audit); the app reads the LATEST version for
-- display. Per-user by construction — `profile_id` binds the score to one user's
-- profile, so users A and B get DIFFERENT rows for the SAME opportunity.

-- CreateTable
CREATE TABLE "public"."match_scores" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "overall" INTEGER NOT NULL,
    "subscores" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidence_refs" JSONB NOT NULL,
    "model_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique over model versions (reproducible rows retained for audit)
CREATE UNIQUE INDEX "match_scores_profile_id_opportunity_id_model_version_key" ON "public"."match_scores"("profile_id", "opportunity_id", "model_version");

-- CreateIndex: read all scores for an opportunity
CREATE INDEX "match_scores_opportunity_id_idx" ON "public"."match_scores"("opportunity_id");

-- AddForeignKey
ALTER TABLE "public"."match_scores" ADD CONSTRAINT "match_scores_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."match_scores" ADD CONSTRAINT "match_scores_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
