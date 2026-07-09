-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "public"."SubscriptionTier" AS ENUM ('free', 'pro');

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "public"."Provenance" AS ENUM ('imported', 'user', 'inferred_confirmed');

-- CreateEnum
CREATE TYPE "public"."SkillLevel" AS ENUM ('beginner', 'intermediate', 'advanced', 'expert');

-- CreateEnum
CREATE TYPE "public"."SourceType" AS ENUM ('ats_public', 'licensed_aggregator', 'gov_feed', 'user_oauth');

-- CreateEnum
CREATE TYPE "public"."AuditActor" AS ENUM ('user', 'twin', 'system');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "auth_provider_id" TEXT NOT NULL,
    "subscription_tier" "public"."SubscriptionTier" NOT NULL DEFAULT 'free',
    "status" "public"."UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_settings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "autonomy_defaults" JSONB NOT NULL,
    "quiet_hours" JSONB,
    "briefing_schedule" JSONB,
    "source_prefs" JSONB NOT NULL,
    "data_use_optins" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "headline" TEXT,
    "summary" TEXT,
    "target_roles" JSONB,
    "target_comp" JSONB,
    "locations" JSONB,
    "remote_pref" TEXT,
    "goals" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."experiences" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "start" DATE,
    "end" DATE,
    "bullets" JSONB,
    "skills" TEXT[],
    "provenance" "public"."Provenance" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."projects" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "links" JSONB,
    "skills" TEXT[],
    "provenance" "public"."Provenance" NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."education" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "institution" TEXT NOT NULL,
    "credential" TEXT,
    "field" TEXT,
    "start" DATE,
    "end" DATE,
    "provenance" "public"."Provenance" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."skill_claims" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "skill" TEXT NOT NULL,
    "level" "public"."SkillLevel" NOT NULL,
    "evidence_refs" JSONB,
    "provenance" "public"."Provenance" NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."opportunities" (
    "id" UUID NOT NULL,
    "source_key" TEXT NOT NULL,
    "source_ref" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "comp" JSONB,
    "location" TEXT,
    "remote" BOOLEAN,
    "requirements_parsed" JSONB,
    "raw_payload" JSONB NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."source_registry" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "type" "public"."SourceType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "hosts" JSONB NOT NULL,
    "rate_policy" JSONB,
    "mapping" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_log" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "actor" "public"."AuditActor" NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "reason" TEXT NOT NULL,
    "model_version" TEXT,
    "trace_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."approval_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_provider_id_key" ON "public"."users"("auth_provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_user_id_key" ON "public"."user_settings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_user_id_key" ON "public"."profiles"("user_id");

-- CreateIndex
CREATE INDEX "profiles_user_id_idx" ON "public"."profiles"("user_id");

-- CreateIndex
CREATE INDEX "experiences_profile_id_idx" ON "public"."experiences"("profile_id");

-- CreateIndex
CREATE INDEX "projects_profile_id_idx" ON "public"."projects"("profile_id");

-- CreateIndex
CREATE INDEX "education_profile_id_idx" ON "public"."education"("profile_id");

-- CreateIndex
CREATE INDEX "skill_claims_profile_id_idx" ON "public"."skill_claims"("profile_id");

-- CreateIndex
CREATE INDEX "opportunities_dedup_key_idx" ON "public"."opportunities"("dedup_key");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_source_key_source_ref_key" ON "public"."opportunities"("source_key", "source_ref");

-- CreateIndex
CREATE UNIQUE INDEX "source_registry_key_key" ON "public"."source_registry"("key");

-- CreateIndex
CREATE INDEX "audit_log_user_id_at_idx" ON "public"."audit_log"("user_id", "at");

-- CreateIndex
CREATE INDEX "approval_tokens_user_id_expires_at_idx" ON "public"."approval_tokens"("user_id", "expires_at");

-- AddForeignKey
ALTER TABLE "public"."user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."experiences" ADD CONSTRAINT "experiences_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."projects" ADD CONSTRAINT "projects_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."education" ADD CONSTRAINT "education_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."skill_claims" ADD CONSTRAINT "skill_claims_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."opportunities" ADD CONSTRAINT "opportunities_source_key_fkey" FOREIGN KEY ("source_key") REFERENCES "public"."source_registry"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."approval_tokens" ADD CONSTRAINT "approval_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
