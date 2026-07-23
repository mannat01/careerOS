-- M09 Step 5 — Public Portfolio (database-schema.md).
-- Portfolio: Profile 1:1 Portfolio — the generator's zero-fabrication draft
-- (`content`) plus the frozen published snapshot (`published_content`).
-- PRIVATE BY DEFAULT: status='private' until the Yellow publish route consumes
-- an ApprovalToken; a not-yet-published portfolio is never publicly readable
-- (public reads serve ONLY status='published' rows' published_content).

CREATE TYPE "PortfolioStatus" AS ENUM ('private', 'published');

CREATE TABLE "portfolios" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "status" "PortfolioStatus" NOT NULL DEFAULT 'private',
    "slug" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "published_content" JSONB,
    "published_at" TIMESTAMP(3),
    "model_version" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portfolios_profile_id_key" ON "portfolios"("profile_id");
CREATE UNIQUE INDEX "portfolios_slug_key" ON "portfolios"("slug");
CREATE INDEX "portfolios_status_slug_idx" ON "portfolios"("status", "slug");

ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_profile_id_fkey"
    FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;