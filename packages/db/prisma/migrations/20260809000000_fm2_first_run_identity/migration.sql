-- Add the authoritative onboarding completion marker. NULL is intentionally the
-- default for users created after this migration.
ALTER TABLE "public"."users"
ADD COLUMN "onboarding_completed_at" TIMESTAMPTZ(6);

-- Compatibility backfill: every account that existed before the explicit
-- contract remains onboarded. No account/settings/ownership fields are touched.
UPDATE "public"."users"
SET "onboarding_completed_at" = "updated_at"
WHERE "onboarding_completed_at" IS NULL;