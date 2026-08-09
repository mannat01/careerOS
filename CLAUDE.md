# CLAUDE.md — CareerOS Execution Guide (for Claude Fable)

You are the implementation engineer for **CareerOS**. You build to the specs in `/docs`; you do **not** redesign the product. If a spec is wrong or missing, flag it and propose a fix — don't silently invent. This file tells you how to work here every session.

---

## 1. Read order (every session, before writing code)
1. `docs/master-plan.md` — stack, glossary, milestone index, execution protocol, DoR/DoD.
2. `docs/architecture.md` — system + CIE services + capability-gate + memory/graph.
3. The **current** `docs/milestone-NN.md` (the one you're assigned) — this is your work order.
4. The relevant slices of `docs/database-schema.md`, `docs/api-spec.md`, `docs/project-structure.md`, `docs/coding-standards.md`.
5. `docs/task-board.md` — execute the current Epic's tasks **in listed order**.

If the product *why* is ever unclear, the authority is `CareerOS-Master-PRD-and-Architecture.md` (incl. Amendment A1 = the Career Intelligence Engine). PRD wins over docs; docs win over your assumptions.

## 2. Prime directive: one milestone at a time
- Work **only** the assigned milestone. Do not pull work from a later milestone, even if it seems easy.
- Confirm the milestone's `Dependencies` are marked done on `task-board.md` before starting (Definition of Ready).
- If you discover missing work, add it to the backlog under the correct milestone — don't expand the current one.

## 3. Non-negotiable invariants (enforce in code, not prose)
1. **Autonomy boundary.** Every side-effecting action passes the capability-gate. Green = auto/advisory. Yellow = requires a valid `ApprovalToken`. Red = never automated, no callable route. A prompt instruction is *never* the control.
2. **Human-in-loop at consequence.** The CIE researches, reasons, drafts, plans — it never submits an application, sends a message, or accepts an offer on the user's behalf.
3. **Sanctioned sources only.** Fetch/act only through the `SourceRegistry` allow-list (ATS public APIs, licensed aggregators, gov feeds, user-OAuth). No scraping ToS-protected boards; non-allow-listed host → `source_not_allowed`.
4. **Zero fabrication.** Agents touching resume/profile output use only real, confirmed facts. Inferred skills stay inferred until the user confirms. This is a release-blocking eval gate.
5. **Auditability + provenance.** Every CIE action logs to the audit trail (who/what/when/why/model_version). Every generated artifact and state dimension carries confidence + provenance + model_version.
6. **Min-slice + tiered models.** Never dump full memory into a prompt. Cheap models for extract/score/rank; frontier for generation/reasoning. Meter cost per call; respect per-user budgets.
7. **Privacy.** Per-user data scoping; full export + hard delete stay working; no training on user data without opt-in; cross-user signals only opt-in + de-identified.

## 4. Definition of Done (per milestone — do not mark done otherwise)
- Every **Acceptance criteria** bullet in the milestone demonstrably passes.
- Every **Testing requirement** exists and is green in CI, including **eval gates** and **security tests** where specified.
- The milestone's **demo path** works end-to-end.
- Any contract you changed (`database-schema.md` / `api-spec.md`) is updated in the **same PR**, with a changelog note.
- No Sev-1/Sev-2 known defects.

## 5. CI gates (must be green to merge — see `coding-standards.md`)
typecheck · lint (incl. import-boundary rules) · unit + integration · **contract tests** (responses match `packages/contracts` zod) · **eval gates** (per-agent regression + zero-fabrication + calibration where relevant) · **security tests** (capability-gate, source allow-list, prompt-injection, cross-user isolation) · a11y (axe AA) · migration check.

### 5a. Pre-push canonical check (local ↔ CI parity)
The canonical pre-push command is **`make verify`**. It mirrors CI exactly — same install mode (`--frozen-lockfile`), same order (typecheck → lint → web production build → test), same Node engine gate — so a green local `make verify` guarantees a green CI `build-test` job for the deterministic (non-DB/Redis) steps:

1. **Node engine gate.** Fails fast if local Node < 22. `package.json#engines.node` is `>=22` (Node 22+ is required because `jsdom@30` / `@testing-library/jest-dom@7` demand it, and CI runs Node 22). This closes the class of failure where a permissive local Node runs deps that then explode on CI's stricter runtime.
2. **`pnpm install --frozen-lockfile`.** Same install mode CI uses. Fails the whole run if `pnpm-lock.yaml` is stale (e.g. a devDep was added to a `package.json` without committing the regenerated lockfile).
3. **`pnpm --filter @careeros/db exec prisma generate`.** CI regenerates Prisma types before lint. The type-aware ESLint rules (`@typescript-eslint/no-unnecessary-type-assertion`, `require-await`, `no-floating-promises`) resolve against `@prisma/client` types; a stale generated client silently changes their verdict.
4. **`pnpm -w typecheck`.**
5. **`pnpm -w lint`** — invokes `turbo run lint --force`, bypassing Turbo's per-package hash cache so a green cached log can never mask a rule that would now flag. CI has no turbo cache; local must not either.
6. **Web production build.** `make verify` and CI run `pnpm --filter @careeros/web build` with only non-secret build-time values (`NEXT_PUBLIC_API_BASE_URL=http://localhost:3001`, `NEXT_PUBLIC_AUTH_PROVIDER=clerk`, `AUTH_PROVIDER=clerk`). This catches Next/Webpack module-resolution, lint, type, and prerender failures before push without requiring local credentials or a running API.
7. **`pnpm -w test`.**

For fast iteration inside a single package, `pnpm run lint:cached` and per-package `vitest` are fine. **Never push based on cached or per-package runs alone** — always run `make verify` immediately before push. If a local-vs-CI gap is ever discovered (as with Batch C: CI Node 20 ran deps requiring Node ≥22, added by Task 5), the fix is to **extend `make verify` to catch that class**, never to weaken a test or skip a gate.

### 5b. Canonical local run

Run the API and web app in **separate terminals**:

```sh
# terminal 1 — API, fixed at http://localhost:3001
make api

# terminal 2 — Next web app, fixed at http://localhost:3000
make web
```

`make api` uses `AUTH_PROVIDER=dev`, `LLM_PROVIDER=fake`, `PORT=3001`, and the
working `pnpm --filter @careeros/api dev` runner (`tsx src/main.ts`). Do **not**
use `node apps/api/src/index.ts`; that is an unbuilt TypeScript/ESM entrypoint.
The liveness check is unauthenticated `GET http://localhost:3001/healthz`, which
must return HTTP 200 with `{ "status": "ok" }` and has no database dependency.
If the API is already responding, probe it — **never kill a server you didn't start.**

### 5c. Database migration workflow

- **Apply:** `make db-migrate` is deployment-only. It safely loads and validates
  the root `.env`, then runs `prisma migrate deploy`. It applies committed
  migrations only, is noninteractive, and is safe to rerun.
- **Author:** migration authoring is a separate, deliberate workflow using the
  `@careeros/db` Prisma authoring script. Never use the canonical apply target to
  generate migration SQL.
- **Review custom SQL:** custom SQL indexes such as pgvector HNSW indexes must be
  preserved. Review every generated migration for destructive drift before it is
  committed; an unexplained `DROP INDEX` is a stop condition, not cleanup.

## 6. Golden-dataset rule (greenfield)
No historical data exists. An agent's **first** deliverable is its hand-authored golden set (10–30 labeled cases) under `evals/<agent>/`, committed before the agent logic. An eval gate with no dataset is not "done."

## 7. Code rules (the ones most often violated)
- TypeScript strict; no `any`. Shared types come from `packages/contracts`; validate all boundary input with zod. **Ingested source text is untrusted** — sanitize before it reaches an LLM.
- Respect package import boundaries (`project-structure.md §2`): `agents` never import `db`; only `memory`/`connectors` touch their stores; `web` never imports server/db packages. No cyclic deps. No `process.env` outside `packages/config`.
- One skill-agent per folder: `agent.ts`, `prompt.ts`, `io.ts` (zod), `agent.eval.ts`. Prompts are versioned; changing one requires its eval to pass.
- Migrations via Prisma only, expand/contract, never one-step breaking.
- Prefer the file editor over multi-line shell heredocs for doc/file edits — heredocs stall the agent terminal.

## 8. Git & PR
- Trunk-based, small PRs, Conventional Commits. Each PR references its milestone + task id from `task-board.md`.
- No PR crosses milestone scope. Update affected docs in the same PR.

## 9. When to stop and ask (don't guess)
Stop and surface a question if: a spec contradicts another spec; an acceptance criterion isn't testable as written; an invariant would have to be weakened to proceed; or a `[Decision]` item from `docs/readiness-review.md` blocks you (LLM vendor strategy, source mix, pricing/free-tier gating). These are product calls, not yours to invent.

## 10. Current status

### Build log
| Date | Milestone | Status | Notes |
| --- | --- | --- | --- |
| 2026-08-09 | FM1 — Foundation + Trust Kit | **COMPLETE** | Task 9 release gates complete: named six-guarantee suite 6/6 (compile-fail sentinels retained), contract-backed MSW fixtures 3/3, route axe + keyboard matrix 19/19, and unmocked Playwright local-stack Twin smoke 1/1 (`context → tool_call → tool_result → token* → done`; Yellow stops at `approval_required`, no token/tool/execution). Workspace 970 passed; frontend 192; eval CI 216; production build and `make verify`/full parity green; `git diff --check` clean. |
| 2026-07-08 | M01 — Foundations | COMPLETE | Pure logic + interfaces; `pnpm -w test` green (80 tests). |
| 2026-07-10 | M01 — Foundations | COMPLETE (real-infra) | NestJS booted against docker (pg+redis+minio); unit 96 / db 8 / e2e 9 green. |
| 2026-07-13 | M02 — Identity, Memory, Graph, Career State Model | **COMPLETE** | Extraction eval 24/24 (incl. 3 zero-fabrication traps), state-model eval 8/8, unit 173+. **Onboarding UI (F02.5) deferred to the web-app effort — tracked follow-up.** |
| 2026-07-14 | M03 — Resume Intelligence | **COMPLETE** | Tailor + scorer + honest-gap guardrail: extraction 24/24, state-model 8/8, tailoring 22/22 zero-fabrication, scoring 9/9. `eval:ci` 78/78 · unit 237+. **Binary PDF/DOCX export + Resume Studio UI deferred to the web-app effort.** |
| 2026-07-14 | M04 — Discovery, Pipeline & Graph Ingestion | IN PROGRESS | Step 1: sanctioned Lever + USAJobs connectors (fixture-driven; live fetch behind allow-list), cross-source dedup, graph upsert on ingest (opportunity→company + opportunity→skill), Prisma-backed opportunity store. |
| 2026-07-20 | M07 — Autonomous Research + Scheduled Automation | **COMPLETE** | Step 5 (approval queue + live autonomy tiers) + Step 4 Part B (scheduler infra e2e). `POST /v1/briefings/:id/items/:itemId/{approve,edit,skip}` behind BearerAuth; Yellow approve mints single-use ApprovalToken bound to (user, action, payloadHash); replay rejected; skip/edit persist. Per-user `UserSettings.autonomyDefaults` **tightens** the registry tier live end-to-end in the gate-interceptor (Green→Yellow denies without token; Green→Red uncallable even with a valid token). `GET /v1/audit` exposes the immutable log. Scheduler infra e2e over docker Postgres+Redis: BullMQ trigger → BriefingRun; Redis SET-NX idempotency holds under N=8 concurrent duplicates → **exactly one** briefing; research→plan diff persists; quiet-hours suppression holds with the real scheduler. `eval:ci` 155/155 · unit 522 · madge clean. **Approval-queue UI + audit UI deferred to the web-app effort.** |
| 2026-07-21 | M08 — Intelligence Dashboards | **COMPLETE** | Step 3 closes Stage 8: `DashboardMetric` read-model persisted (Prisma migration `20260720000000_m08_dashboards`; per-user scoped via FK cascade; indexed `(profile_id, metric, computed_at desc)`). `PrismaDashboardMetricStore` behind a narrow structural port. Green endpoints `GET /v1/cie/dashboards` + `GET /v1/cie/dashboards/:metric` behind `BearerAuth` — **every response carries value + trend + explanation + evidence + linked action + freshness**; a bare number is impossible. Cross-user → 404. Reactive recompute wired to M04 change hooks (new application → opportunity_quality/recruiter_engagement; completed interview → interview_readiness); scheduler maintenance sweep (`refreshStaleDashboards`) refreshes stale users with poison-user isolation. Thin-evidence metrics surface `status='insufficient_data' / value=null / confidence ≤ 0.5` **through the API** (no invented value). `eval:ci` 171/171 across 9 suites · unit 563 · madge clean. **Dashboard UI deferred to the web-app effort.** |
| 2026-07-22 | M09 — Growth Surfaces | **COMPLETE** | **(interview prep, skills, drafts, portfolio; portfolio/prep UIs deferred to the web-app effort.)** Step 5 closes Stage 9 with public portfolio generation: `@careeros/cie-portfolio` composes the portfolio STRICTLY from real profile facts + projects + graph evidence via narrow ports (never `@careeros/db`); every rendered item carries `factRefs` resolving to the sanctioned allow-list (same grounding discipline as M03 tailoring / M09 drafting) and a self-verify oracle throws `PortfolioIntegrityError` before persist — the integrity suite proves the oracle passes honest output and CATCHES a fabricator that invents a project the user never had (plus invented skills / ungrounded items). Prisma migration `20260722100000_m09_portfolio` (`Portfolio`: user-unique, `status` private\|published — **private by default**, unique `slug`, `content` draft + frozen `published_content` snapshot). `POST /v1/portfolio` (generate/update draft) + `GET /v1/portfolio` (owner view) are Green; `POST /v1/portfolio/publish` is **Yellow** — `withCapabilityGate('portfolio.publish')` requires a single-use ApprovalToken and audits the decision; the public read (`GET /v1/portfolio/public/:slug`) serves ONLY the frozen snapshot of `status='published'` rows, so an unpublished portfolio is never publicly readable (404 even with the correct slug) and post-publish draft edits never leak. `eval:ci` 208/208 · unit 630+ · madge clean. |
| 2026-07-28 | M10 — Compound & Extend | **COMPLETE** | Calibration, cross-user market intel, negotiation coaching, plugin platform, and PKM (notes/journal/saved) — UIs deferred to the web-app effort. Step 5 closes the build: `@careeros/cie-pkm` sanitizes untrusted user text BEFORE persist/graph-ingest (HTML/script stripped; prompt-injection markers flagged, entry still stored + downweighted), then ingests entry + tag nodes into the per-user graph tagged `pkm:user-authored:<entryId>` provenance so the state model + planner weigh PKM signals as user-authored (never confused with imported/inferred facts) — wired via narrow `PkmStorePort` + `PkmGraphIngestPort` ports (never `@careeros/db`). Green endpoints `POST/GET /v1/pkm`, `GET/DELETE /v1/pkm/:id` are per-user scoped (cross-user id → 404); `DELETE` PURGES the derived graph contribution atomically (stored `graphNodeIds` drive an exact-scope purge; the integrity suite proves both invariants: create→graph-ingest with user-authored provenance, and delete→graph purge). **LAUNCH-BLOCKER (public plugins):** replace `node:vm` with a hardened isolate (isolated-vm / out-of-process / WASM/container) before enabling untrusted third-party plugins; `node:vm` is not a security boundary. Defense-in-depth (host userId scoping + capability-gate) mitigates but does not cover env/secret/fs/network exposure on vm escape. See `docs/build-operating-model.md`. |

- **M10 — Compound & Extend: COMPLETE (2026-07-28)** (calibration, cross-user intel, negotiation, plugin platform, PKM; UIs deferred to the web-app effort). PKM (notes/journal/saved) is per-user scoped, sanitizes untrusted user text before persist/graph-ingest, feeds derived nodes/edges into the state model + planner with `pkm:user-authored:<entryId>` provenance, and delete atomically purges the entry AND its derived graph contribution — wired via narrow ports (never `@careeros/db`). **Plugin-sandbox LAUNCH-BLOCKER:** the current `node:vm`-based sandbox is NOT a security boundary; before enabling untrusted third-party plugins we must replace it with a hardened isolate (isolated-vm / out-of-process / WASM/container). Defense-in-depth (host userId scoping + capability-gate) mitigates but does not cover env/secret/fs/network exposure on vm escape. Reference plugins + registry + capability-gated toolshim ship green; recorded prominently in `docs/build-operating-model.md`.
- **M09 — Growth Surfaces: COMPLETE (2026-07-22)** (interview prep, skills, drafts, portfolio; portfolio/prep UIs deferred to the web-app effort). Interview prep grounds every question/answer scaffold in real graph evidence (zero fabrication, eval-gated); skill-gap analysis feeds the planner; cover/outreach drafting is Green with `draft.send` **Yellow** + ToS-gated (approval can never override channel ToS); the portfolio generator composes strictly from real facts/projects/graph evidence with a fabrication-catching integrity oracle, `portfolio.publish` is **Yellow** + audited, and unpublished portfolios are **private by default** (public reads serve only the frozen published snapshot).
- **M07 — Autonomous Research + Scheduled Automation: COMPLETE (2026-07-20)** (approval-queue + audit UI deferred to the web-app effort). Step 5 makes autonomy tiers **live end-to-end**: the app-side gate-interceptor consults a per-user `UserSettings.autonomyDefaults[action]` resolver BEFORE `enforce()`, so a user override can only ever **tighten** the registry tier (Green→Yellow requires a token; Green→Red is uncallable even with a valid token; Yellow→Green is impossible by construction). BriefingItem approve/edit/skip live behind `BearerAuthGuard` on the briefing controller: approving a Yellow item mints a single-use `ApprovalToken` bound to `(userId, action, payloadHash)`, verified + consumed by the M01 capability-gate; replay is denied. Every allow/deny is written to the immutable audit log; `GET /v1/audit` exposes it. Step 4 Part B closes the scheduler infra gap: a Redis-backed `IdempotencyStore` (`SET key value NX EX 48h`) sits under a BullMQ `briefing-scheduler` worker; the e2e (`briefing-scheduler.e2e.test.ts`) fires 8 concurrent duplicate triggers for the same `(user, day)` against **real docker Redis** and proves exactly-one composer invocation (SETNX wins first, all losers short-circuit to `duplicate`). The research→plan hook regenerates on HIGH-impact findings with the diff captured; quiet-hours suppression holds with the real scheduler (composer is never called). Gates: `eval:ci` 155/155 · unit 522 (api 142 + workers 44 + evals 114 + packages 222) · api integration 4/4 scheduler-infra + 5/5 briefing + 3/3 twin · madge clean.
- **M04 — Discovery, Pipeline & Graph Ingestion: IN PROGRESS.** Step 1 adds two sanctioned `SourceConnector` adapters (Lever public API + USAJobs) alongside the existing Greenhouse adapter, each with a rate policy + normalization mapping and a committed fixture (no live network in tests; live fetch stays behind the allow-list guard). Cross-source dedup (`dedupKey`) collapses the same posting from Greenhouse + Lever + USAJobs into ONE canonical Opportunity. Ingest upserts opportunity → company + opportunity → required-skill nodes/edges idempotently on the per-user M02 graph. Ingested job text is sanitized (untrusted; injection defense). Opportunities persist via Prisma against live Postgres (integration tests). See `docs/milestone-04.md`.
- **M03 — Resume Intelligence: COMPLETE (2026-07-14)** (binary PDF/DOCX export + Resume Studio UI deferred to the web-app effort — tracked follow-up). The M03 backend — tailor agent (ATS-safe render, no-fabrication over allowed evidence), match scorer with honest-gap guardrail (`missing_evidence` explanations tied to actual profile facts) — is complete and gated: `eval:ci` 78/78 (extraction 24 + state-model 8 + tailoring 22 + scoring 9 = 63 eval assertions + 15 dataset-integrity), unit + integration 237+.

- **M02 — Identity, Memory, Graph, Career State Model: COMPLETE (2026-07-13)** (onboarding UI deferred to the web-app effort — tracked follow-up).

- **Tracked follow-up (deferred from M02):** Onboarding UI (F02.5 — import → reflect-back; `CareerStatePanel`, `ProvenanceTag`, `KnowledgeGraphExplorer`, `ConfidenceBadge`) is deferred to the web-app effort. The M02 backend (extraction, memory, graph, state model) is complete and gated; the UI is a presentation layer over already-green services.
- **M01 — Foundations: COMPLETE (2026-07-10).**
- **M01 record (2026-07-08, sandbox build — pure logic + interfaces, infra stubbed):**
  - DONE (implemented + tested, `pnpm -w test` green — 80 tests / 10 files):
    - `packages/config` — single zod env schema; only sanctioned `process.env` read.
    - `packages/contracts` — error model (incl. `capability_denied`, `source_not_allowed`), User/UserSettings/MeResponse (conservative autonomy defaults), canonical Opportunity, SourceRegistry entry.
    - `packages/capability-gate` — tier registry (Green/Yellow/Red), ApprovalToken mint/verify bound to (userId, action, payloadHash), single-use + expiring, framework-agnostic `enforce()` + worker tool-call wrapper. ⚑ Required security suite green (Yellow w/o token denied; invalid/expired/mismatch/replay denied; Red has no allowed path; fail-closed on unknown actions).
    - `packages/connectors` — `SourceConnector` interface, allow-list registry + guarded fetch (rejects non-allow-listed hosts BEFORE transport), Greenhouse adapter (fixture-driven, per ADR-002), sanitizer + injection flags, dedup. ⚑ Required allow-list security suite green.
    - `packages/observability` — structured logger with PII redaction; immutable audit client with injectable sink; trace-id helper (OTel init stubbed).
    - `packages/llm-gateway` — tiered (cheap|frontier) provider abstraction per ADR-001, cost-metering hook, trace-id attach, FakeLlmProvider; Anthropic adapter stubbed.
    - `packages/db` — `prisma/schema.prisma` authored for all 11 M01 entities (pgvector columns, user_id scoping, provenance, cascades); validated via `pnpm --filter @careeros/db schema:validate` (WASM validator; no live DB). SourceRegistry seed = exactly one enabled source (greenhouse).
    - `apps/api` — `GET /v1/me`, `PATCH /v1/me/settings`, Yellow `DELETE /v1/me` behind the capability-gate wrapper; per-user scope helper. Handlers are framework-agnostic pure functions; tested with in-memory fakes.
  - **Step 3c (2026-07-10, real-infra): NestJS app booted for real — closes M01.** `apps/api/src/main.ts` (composition root: `buildDepsFromEnv` → Prisma stores + DevAuth + BullMQ + MinIO-or-fake ObjectStorage; env read ONCE via `loadEnv`), `AppModule.forRoot(deps)`, `BearerAuthGuard` (delegates to `resolveBearerToken`), `MeController` serving `GET /v1/me`, `PATCH /v1/me/settings`, Yellow `DELETE /v1/me` (full cascade: DB rows via `onDelete: Cascade` + object-storage prefix delete + tokens; gate-audited), Green `POST /v1/me/export` (BullMQ `me-export` enqueue). e2e: `apps/api/test/me.e2e.test.ts` (supertest, 9 tests — 401s, scoping, validation 422, capability_denied, cascade, export enqueue, replay-denied) wired into CI after the db integration step. `PrismaAuditSink` drops P2003 FK errors post-hard-delete (privacy cascade removes the audit trail by design). **Verified locally against docker (pg+redis+minio): unit 96 green (DB-free), db integration 8 green, api e2e 9 green, typecheck+lint+madge clean; live curl demo (GET /v1/me 200 with minted dev token; DELETE /v1/me without approval → 403 capability_denied; no auth → 401).**
  - Deferred to later milestones (grep `STUB(M01)`): managed-auth (Clerk) live verification, BullMQ ingestion worker wiring (export worker consuming `me-export`), live Greenhouse fetch, OTel exporter, Terraform (F01.8), eslint import-boundary rule.
- Update this section at each milestone handoff.