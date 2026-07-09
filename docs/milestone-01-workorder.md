# M01 Work Order — Foundations (Fable execution brief)

**This is the executable brief for Milestone 01.** It expands `milestone-01.md` into an ordered, checkable task sequence with per-task acceptance. Work top to bottom. Do not start M02 work. Paste `§Kickoff prompt` (bottom) to begin.

**Goal of M01:** the skeleton + the invariants proven from day one. Demo path at the end: a signed-in user; one real job in the DB from a sanctioned source; a Yellow action blocked without approval and audited; a non-allow-listed source rejected.

---

## Sequenced tasks

### 1. Repo & tooling (F01.1) — S/M
- [ ] Init Turborepo + pnpm workspaces with the exact tree in `project-structure.md §1` (apps `web`,`api`,`workers`; packages `db`,`contracts`,`llm-gateway`,`agents`,`cie`,`memory`,`connectors`,`capability-gate`,`ui`,`config`,`observability`; `evals`,`infra`,`docs`).
- [ ] `packages/config`: shared `tsconfig`, eslint (with import-boundary rule enforcing `project-structure.md §2`), tailwind preset, and the **single zod env schema** (no `process.env` elsewhere).
- [ ] CI (GitHub Actions): typecheck, lint, test, migration-check, preview env per PR.
- **Accept:** `pnpm install && pnpm build && pnpm lint && pnpm test` green on an empty skeleton; a deliberate cross-boundary import fails lint.

### 2. Data core (F01.3) — M
- [ ] `packages/db` Prisma schema for M01 entities only: `User`, `UserSettings`, `Profile`, `Experience`, `Project`, `Education`, `SkillClaim`, `Opportunity`, `SourceRegistry`, `AuditLog`, `ApprovalToken` (per `database-schema.md`; include `user_id` scoping cols, timestamps, provenance where specified). Stub embeddings column type (pgvector) even if unused yet.
- [ ] Initial migration; seed `SourceRegistry` with the one M01 source enabled.
- **Accept:** migrate up/down clean; `SourceRegistry` has exactly one enabled source.

### 3. Observability & audit (F01.4) — M
- [ ] `packages/observability`: OTel tracing init, structured logger (no PII), and an `audit` client writing immutable `AuditLog` rows (actor/action/target/reason/model_version/trace_id).
- **Accept:** a sample traced operation emits a span + a linked `AuditLog` row.

### 4. Capability-gate (F01.5) — L · **security-critical**
- [ ] `packages/capability-gate`: tier registry (Green/Yellow/Red); `ApprovalToken` mint + verify (bound to user + action + payload-hash, single-use, expiring); NestJS interceptor for the API and a wrapper for worker tool calls.
- [ ] Wire it into `apps/api/common/capability-gate`.
- **Accept (⚑ required security test):** a Yellow route without a token → `capability_denied` + `AuditLog` entry; with an invalid/expired/mismatched-payload token → denied; a Red action has no callable route.

### 5. Auth & account (F01.2) — M
- [ ] Integrate managed auth (Clerk **or** WorkOS — pick per `readiness-review.md` decision note; both fine). Passkeys/SSO/MFA available.
- [ ] `GET /v1/me`, `PATCH /v1/me/settings`; per-user scope guard (user A can't read B); conservative default `UserSettings` (autonomy defaults conservative).
- [ ] Data lifecycle: `POST /v1/me/export` (enqueue full export) and `DELETE /v1/me` (Yellow; cascade delete owned rows + artifacts + tokens).
- **Accept:** new user gets conservative settings; cross-user read blocked; export archive complete; hard delete removes all owned data.

### 6. Connector framework + first source (F01.6) — L · **security-critical**
- [ ] `packages/connectors`: `SourceConnector` interface + allow-list registry; the fetch layer **rejects any non-allow-listed host** (`source_not_allowed`).
- [ ] One no-auth ATS adapter (Greenhouse **or** Lever public API) → normalize to canonical `Opportunity` → dedup → persist. Ingestion worker + BullMQ wiring in `apps/workers/ingestion`.
- [ ] Treat fetched text as untrusted (sanitize; injection-defense hook even if minimal now).
- **Accept (⚑ required security test):** ingestion persists ≥1 deduped `Opportunity`; a second run creates no duplicate; a fetch to a non-allow-listed host is rejected.

### 7. LLM gateway skeleton (F01.7) — S
- [ ] `packages/llm-gateway`: provider client with a `tier` param (cheap|frontier), cost-metering hook, trace-id attach. No product prompts yet.
- **Accept:** a smoke call routes by tier and records a cost metric + trace.

### 8. Infra (F01.8) — M
- [ ] `infra/` Terraform for Postgres (+pgvector), Redis, object storage, and the deploy target; Dockerfiles for `api`/`workers`/`web`.
- **Accept:** infra applies in a scratch env; apps boot and connect.

---

## Milestone-level Definition of Done (gate to M02)
- [ ] All task accepts above pass.
- [ ] **Both required security tests green in CI** (capability-gate; source allow-list) — these now run on every future PR.
- [ ] Demo path works: sign in → see one real ingested opportunity → Yellow-without-token blocked + audited → non-allow-listed source rejected.
- [ ] `CLAUDE.md §10` updated to "M01 complete; M02 ready."
- [ ] Docs touched updated in-PR.

## Out of scope for M01 (do NOT build)
Resume import/extraction, memory service, graph, Career State Model, scoring, tailoring, briefing, any CIE reasoning — those are M02+. M01 stops at "skeleton + one source + invariants enforced."

---

## §Kickoff prompt (paste to Fable to start M01)

> You are the implementation engineer for CareerOS. First read, in order: `CLAUDE.md`, `docs/master-plan.md`, `docs/architecture.md`, `docs/milestone-01.md`, `docs/milestone-01-workorder.md`, and the M01-relevant slices of `docs/database-schema.md`, `docs/api-spec.md`, `docs/project-structure.md`, `docs/coding-standards.md`.
>
> Then execute **Milestone 01 — Foundations** by working `docs/milestone-01-workorder.md` top to bottom, one task at a time, opening a small PR per task that references the task id from `docs/task-board.md` (Epic E01). Do not build anything from M02 or later.
>
> Enforce all invariants in `CLAUDE.md §3` as code (capability-gate, sanctioned-source allow-list, audit) — the two security tests (Yellow/Red gating; non-allow-listed source blocked) must be green before M01 is done. Where the work order says "pick" (managed-auth vendor; Greenhouse vs Lever), choose the simpler option and note the choice in the PR.
>
> Stop and ask me only if you hit a spec contradiction, an untestable acceptance criterion, or a `[Decision]` item from `docs/readiness-review.md`. When every M01 acceptance criterion passes and the demo path works end-to-end, update `CLAUDE.md §10` and report M01 complete with the demo steps to verify.
