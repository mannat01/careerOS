-- M08 Step 3 — Intelligence Dashboards read-model.
-- Persists per-user, per-metric DashboardMetric rows (one per computed_at).
-- The dashboard endpoints read the LATEST row per (profile, metric).
-- Cross-user isolation is enforced by the profile_id FK + cascade.

CREATE TABLE "dashboard_metrics" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "metric" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "value" INTEGER,
    "trend" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidence_refs" JSONB NOT NULL DEFAULT '[]',
    "linked_action_id" UUID,
    "confidence" DOUBLE PRECISION NOT NULL,
    "model_version" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_metrics_pkey" PRIMARY KEY ("id")
);

-- The read-model's hot path: latest row per (profile, metric) — DESC on computed_at.
CREATE INDEX "dashboard_metrics_profile_id_metric_computed_at_idx"
    ON "dashboard_metrics" ("profile_id", "metric", "computed_at" DESC);

ALTER TABLE "dashboard_metrics"
    ADD CONSTRAINT "dashboard_metrics_profile_id_fkey"
    FOREIGN KEY ("profile_id") REFERENCES "profiles" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;