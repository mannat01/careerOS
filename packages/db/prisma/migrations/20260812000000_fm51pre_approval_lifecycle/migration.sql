-- FM5.1-pre: canonical approval lifecycle metadata + states.
ALTER TYPE "public"."BriefingItemState" ADD VALUE IF NOT EXISTS 'executed';
ALTER TYPE "public"."BriefingItemState" ADD VALUE IF NOT EXISTS 'denied';

ALTER TABLE "public"."briefing_items"
  ADD COLUMN "action" TEXT,
  ADD COLUMN "why" TEXT,
  ADD COLUMN "resource_refs" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Existing items predate first-class metadata. Backfill explicit migration values;
-- runtime creation always supplies action/why directly and never derives from kind.
UPDATE "public"."briefing_items"
SET "action" = CASE
      WHEN "autonomy_tier" = 'yellow' THEN 'briefing.item.execute'
      ELSE 'briefing.generate'
    END,
    "why" = CASE
      WHEN "autonomy_tier" = 'yellow'
        THEN 'This legacy prepared action requires explicit approval before execution.'
      ELSE 'Legacy briefing item retained for review.'
    END
WHERE "action" IS NULL OR "why" IS NULL;

ALTER TABLE "public"."briefing_items"
  ALTER COLUMN "action" SET NOT NULL,
  ALTER COLUMN "why" SET NOT NULL;

ALTER TABLE "public"."approval_tokens"
  ADD COLUMN "approval_id" UUID;

CREATE INDEX "briefing_items_state_autonomy_tier_idx"
  ON "public"."briefing_items"("state", "autonomy_tier");
CREATE INDEX "approval_tokens_approval_id_consumed_at_idx"
  ON "public"."approval_tokens"("approval_id", "consumed_at");

ALTER TABLE "public"."approval_tokens"
  ADD CONSTRAINT "approval_tokens_approval_id_fkey"
  FOREIGN KEY ("approval_id") REFERENCES "public"."briefing_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;