-- M04 application pipeline — Application + timeline + follow-up tables
-- (database-schema.md §application). Additive, expand-only migration: no existing
-- tables/columns are altered, so it is backward-compatible with M01/M02/M04-match
-- (migration-policy §5).
--
-- Application is the per-user CRM record binding ONE user to ONE opportunity as it
-- moves through the fixed status pipeline. PER-USER scoped — UNIQUE (user_id,
-- opportunity_id) so a user tracks a given opportunity once; users A and B keep
-- independent applications for the SAME global opportunity.
--
-- application_timeline is APPEND-ONLY status-change history (one row per
-- meaningful transition, with the actor that drove it). application_follow_ups are
-- INTERNAL reminders (Green — no external send). All three cascade from the parent.

-- CreateEnum
CREATE TYPE "public"."ApplicationStatus" AS ENUM ('saved', 'drafting', 'ready', 'applied', 'screening', 'interviewing', 'offer', 'closed');

-- CreateTable
CREATE TABLE "public"."applications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "resume_variant_id" TEXT,
    "status" "public"."ApplicationStatus" NOT NULL DEFAULT 'saved',
    "notes" TEXT,
    "follow_up_at" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."application_timeline" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "from_status" "public"."ApplicationStatus",
    "to_status" "public"."ApplicationStatus" NOT NULL,
    "actor" "public"."AuditActor" NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."application_follow_ups" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one application per (user, opportunity)
CREATE UNIQUE INDEX "applications_user_id_opportunity_id_key" ON "public"."applications"("user_id", "opportunity_id");

-- CreateIndex: board query — a user's applications by status
CREATE INDEX "applications_user_id_status_idx" ON "public"."applications"("user_id", "status");

-- CreateIndex: read a timeline oldest→newest
CREATE INDEX "application_timeline_application_id_at_idx" ON "public"."application_timeline"("application_id", "at");

-- CreateIndex: read due follow-ups per application
CREATE INDEX "application_follow_ups_application_id_due_at_idx" ON "public"."application_follow_ups"("application_id", "due_at");

-- AddForeignKey
ALTER TABLE "public"."applications" ADD CONSTRAINT "applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."application_timeline" ADD CONSTRAINT "application_timeline_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."application_follow_ups" ADD CONSTRAINT "application_follow_ups_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
