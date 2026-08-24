-- CreateEnum: PKM provenance is intentionally a one-value, server-owned domain.
CREATE TYPE "public"."PkmProvenance" AS ENUM ('user');

-- CreateTable
CREATE TABLE "public"."pkm_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "provenance" "public"."PkmProvenance" NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pkm_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pkm_entries_user_id_idx" ON "public"."pkm_entries"("user_id");

-- AddForeignKey
ALTER TABLE "public"."pkm_entries" ADD CONSTRAINT "pkm_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
