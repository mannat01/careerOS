# CareerOS — Database Schema

**Derived from:** PRD §14. Postgres + pgvector, Prisma. Migrations in `packages/db` are the source of truth; this doc is the design intent. Every table has `id (uuid pk)`, `created_at`, `updated_at`; user-owned tables have `user_id` with a row-level scope enforced in the app layer.

---

## 1. Entity overview

```
User ─1:1─ Profile ─1:N─ Experience / Project / Education / SkillClaim
Profile ─1:N─ ResumeModel ─1:N─ ResumeVariant ─N:1─ Opportunity
User ─1:N─ Application ─N:1─ Opportunity
(Profile,Opportunity) ─1:1─ MatchScore
Application ─1:N─ InterviewPrep ─1:N─ MockSession
Profile ─1:N─ SkillGap ─1:N─ LearningItem
User ─1:N─ MemoryEvent (append-only)
Profile ─1:N─ DerivedInsight (regenerable)
User ─1:N─ BriefingRun ─1:N─ BriefingItem ─1:N─ ApprovalToken
User ─1:N─ ConnectedSource (OAuth)  |  SourceRegistry (global allow-list)
```

## 2. Tables

### identity
- **User** — `email`, `auth_provider_id`, `subscription_tier` (enum: free|pro), `status`. Settings child below.
- **UserSettings** — `user_id`, `autonomy_defaults` (jsonb: per action-type Green/Yellow/Red), `quiet_hours` (jsonb), `briefing_schedule` (cron/tz), `source_prefs` (jsonb), `data_use_optins` (jsonb: training, cross_user_intel).
- **Profile** — `user_id (unique)`, `headline`, `summary`, `target_roles` (jsonb), `target_comp` (jsonb), `locations`/`remote_pref`, `goals` (jsonb). Canonical identity root.
- **Experience** — `profile_id`, `company`, `title`, `start`/`end`, `bullets` (jsonb[]), `skills` (text[]), `provenance` (enum: imported|user|inferred_confirmed), `version`, `embedding vector`.
- **Project** — `profile_id`, `name`, `description`, `links` (jsonb), `skills` (text[]), `provenance`, `embedding vector`.
- **Education** — `profile_id`, `institution`, `credential`, `field`, `start`/`end`, `provenance`.
- **SkillClaim** — `profile_id`, `skill`, `level` (enum), `evidence_refs` (jsonb → experience/project ids), `provenance`, `embedding vector`.

> **Provenance is mandatory** on all inferred facts (PRD §14) so the UI can show *why the Twin believes something* and the user can correct it. `inferred_confirmed` means the Twin proposed and the user accepted.

### resume
- **ResumeModel** — `profile_id`, `name`, `selected_items` (jsonb: ordered experience/project/skill ids + phrasing overrides), `base` (bool). A *structured resume*, not a file.
- **ResumeVariant** — `resume_model_id`, `opportunity_id (nullable)`, `render_artifact_key` (S3), `diff` (jsonb vs base), `rationale` (text), `model_version`, `ats_check` (jsonb). Tailored version.

### opportunity
- **Opportunity** — `source` (fk SourceRegistry), `source_ref` (unique w/ source), `company`, `role`, `comp` (jsonb), `location`/`remote`, `requirements_parsed` (jsonb), `raw_payload` (jsonb), `dedup_key`, `ingested_at`, `embedding vector`. Global (not user-owned); deduped across sources by `dedup_key`.
- **MatchScore** — `profile_id`, `opportunity_id`, `overall` (0–100), `subscores` (jsonb: skills/seniority/domain/comp/location/trajectory), `explanation` (text), `model_version`. Unique `(profile_id, opportunity_id, model_version)` — note this is **1:many over model versions** (each version is a reproducible row); the app reads the *latest* version for display, older versions retained for audit/reproducibility. (The §1 overview's "1:1" is the *current-version* logical view.)

### application
- **Application** — `user_id`, `opportunity_id`, `status` (enum: saved|drafting|ready|applied|screening|interviewing|offer|closed), `resume_variant_id`, `documents` (jsonb), `timeline` (jsonb events), `follow_up_at`. **`status='applied'` is only ever set by an explicit user action** (submission is human-in-loop, PRD §14) — never by an agent side effect.

### prep
- **InterviewPrep** — `application_id`, `questions` (jsonb: generated + likely), `evidence_map` (jsonb: question→profile evidence), `model_version`.
- **MockSession** — `interview_prep_id`, `transcript` (jsonb), `feedback` (jsonb), `scores` (jsonb).
- **SkillGap** — `profile_id`, `opportunity_id (nullable)`, `gap` (text), `severity`, `source` (per-opp|aggregate).
- **LearningItem** — `skill_gap_id`, `resource` (jsonb), `status` (enum: suggested|in_progress|done), `progress`.

### memory
- **MemoryEvent** (append-only) — `user_id`, `type` (enum: twin_action|user_decision|outcome|system), `payload` (jsonb), `rationale` (text), `autonomy_tier`, `occurred_at`. Immutable; no updates/deletes except via account hard-delete.
- **DerivedInsight** — `profile_id`, `statement` (text), `source_refs` (jsonb), `freshness_at`, `model_version`. Regenerable; safe to drop/rebuild.

### automation / audit
- **BriefingRun** — `user_id`, `trigger` (enum: scheduled|manual), `status` (enum: queued|running|partial|complete|failed), `inputs` (jsonb), `steps` (jsonb: per-step status/cost/trace_id), `cost_total`, `started_at`/`finished_at`. The audit backbone.
- **BriefingItem** — `briefing_run_id`, `kind` (enum: opportunity|tailored_resume|draft|prep|gap|note), `ref_id`, `autonomy_tier`, `state` (enum: proposed|approved|edited|skipped|failed).
- **ApprovalToken** — `user_id`, `action`, `payload_hash`, `expires_at`, `consumed_at`. Binds a Yellow action to a specific approved payload; single-use.

### connectors
- **SourceRegistry** (global) — `key`, `type` (ats_public|licensed_aggregator|gov_feed|user_oauth), `enabled`, `rate_policy` (jsonb), `mapping` (jsonb). The allow-list; a source absent/`enabled=false` cannot be fetched.
- **ConnectedSource** — `user_id`, `source_key`, `oauth_token_enc`, `scopes`, `status`, `revoked_at`. Encrypted, user-revocable.

### audit/security shared
- **AuditLog** (immutable) — `user_id`, `actor` (user|twin|system), `action`, `target`, `reason`, `model_version`, `trace_id`, `at`. Append-only; feeds the audit UI.

### cie — Career Intelligence Engine (PRD Amendment A1)

- **CareerStateModel** — `profile_id (unique)`, `version`, `updated_at`. Header for the dynamic user model.
- **CareerStateDimension** — `state_model_id`, `dimension` (enum: goals|interests|strengths|weaknesses|demonstrated_skills|inferred_skills|learning_velocity|preferred_industries|preferred_company_sizes|comp_goals|geo_prefs|work_style|values|leadership_readiness|communication_style|interview_performance|portfolio_quality|recruiter_engagement|market_position), `value` (jsonb), `confidence` (0–1), `provenance`, `evidence_refs` (jsonb → graph node/event ids), `freshness_at`, `model_version`. One row per dimension per model; history retained via `MemoryEvent`.
- **GraphNode** — `user_id`, `kind` (enum: person|company|recruiter|interview|resume|project|certification|skill|industry|application|outcome|learning_resource|opportunity|goal), `ref_id (nullable)` (points to the owning domain row when one exists), `label`, `attrs` (jsonb), `embedding vector`. The Career Knowledge Graph node.
- **GraphEdge** — `user_id`, `from_node_id`, `to_node_id`, `type` (enum: worked_at|requires_skill|has_skill|demonstrates|interviewed_with|led_to_outcome|builds_toward_goal|taught_by|competes_with|reports_to|located_in|targets|evidenced_by|...), `weight`, `attrs` (jsonb), `provenance`. Typed relationship; multi-hop traversal.
- **StrategyPlan** — `profile_id`, `horizon` (enum: d30|d90|y1|y3|y5), `status` (enum: active|superseded), `objectives` (jsonb: objective+rationale+expected_impact+confidence), `actions` (jsonb: sequenced, each linked to skill/project/cert/role/person node + dashboard metric it moves), `generated_from` (jsonb: state/goal/graph/research snapshot refs), `diff` (jsonb vs prior), `model_version`. One active plan per horizon; regeneration supersedes.
- **PlanAction** — `strategy_plan_id`, `title`, `kind` (skill|project|cert|role|network|other), `target_node_id (nullable)`, `expected_impact`, `confidence`, `status` (suggested|in_progress|done|dropped), `due`. (Normalized for adherence tracking; mirrors `StrategyPlan.actions`.)
- **Recommendation** — `profile_id`, `question`, `alternatives` (jsonb), `evidence_refs` (jsonb), `reasoning` (text), `confidence` (0–1), `assumptions` (jsonb), `recommendation` (text), `optionality_note` (text), `decision` (enum: pending|accepted|rejected|deferred), `outcome_ref (nullable)`, `model_version`. Stores the decision-support contract + later outcome for **calibration scoring**.
- **ResearchSource** (global) — extends `SourceRegistry` semantics for research feeds (trends/salary/skills/tech/certs/company/industry).
- **ResearchFinding** — `domain` (enum), `summary`, `raw_ref` (jsonb source cite), `entities` (jsonb → graph node links), `observed_at`, `embedding vector`. Global where market-wide; user-linked syntheses live as `GraphNode(kind=outcome/learning_resource)` + `MemoryEvent`.
- **DashboardMetric** — `profile_id`, `metric` (enum: career_momentum|interview_readiness|skill_momentum|market_positioning|salary_trajectory|opportunity_quality|networking_strength|recruiter_engagement|portfolio_completeness|strategic_recos), `value` (jsonb), `trend` (jsonb), `explanation` (text), `evidence_refs` (jsonb), `linked_action_id (nullable)`, `computed_at`, `model_version`. Read model for the intelligence dashboards.

> **Invariants preserved:** every CIE artifact carries `confidence` + `provenance`/`evidence_refs` + `model_version` (explainable, calibratable, regenerable). Inferred skills live in `CareerStateDimension(dimension=inferred_skills)` and are **never** promoted to a `ResumeVariant` fact without user confirmation (zero-fabrication). All CIE writes emit audit + `MemoryEvent`.

## 3. Indexing & performance

- `Opportunity`: btree on `(source, source_ref)` unique, `dedup_key`; ivfflat/hnsw on `embedding`.
- `Experience/Project/SkillClaim`: hnsw on `embedding` for memory retrieval; btree on `profile_id`.
- `Application`: btree on `(user_id, status)`, `follow_up_at`.
- `MatchScore`: unique `(profile_id, opportunity_id, model_version)`.
- `MemoryEvent`/`AuditLog`: btree on `(user_id, occurred_at/at)`; partition by month at scale.
- Every user-owned table indexed on `user_id`; sharding key is `user_id` (designed-for).
- **CIE:** `GraphNode` hnsw on `embedding`, btree on `(user_id, kind)`; `GraphEdge` btree on `(user_id, from_node_id, type)` and `(user_id, to_node_id, type)` for bidirectional traversal; `CareerStateDimension` unique `(state_model_id, dimension)`; `StrategyPlan` partial-unique on `(profile_id, horizon)` where `status='active'`; `DashboardMetric` btree on `(profile_id, metric, computed_at)`; `ResearchFinding` hnsw on `embedding`, btree on `(domain, observed_at)`.

## 4. Data lifecycle

- **Export:** full per-user export (all owned rows + artifacts) — first-class from M01.
- **Hard delete:** cascade delete of all user-owned rows + S3 artifacts + connected-source tokens; `MemoryEvent`/`AuditLog` deleted on account deletion (not before). Global `Opportunity`/`SourceRegistry` are not user data.
- **Provenance & reproducibility:** `model_version` stamped on every generated artifact (`MatchScore`, `ResumeVariant`, `InterviewPrep`, `DerivedInsight`) so outputs are explainable and regenerable.

## 5. Migration policy

Prisma migrations only; no manual DDL. Every schema change ships with the code that uses it in the same PR, is backward-compatible or gated by a two-step expand/contract migration, and updates this doc's changelog.
