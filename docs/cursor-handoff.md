# CareerOS — Cursor Handoff Brief

**Purpose:** get Cursor productive on this repo cold. Two jobs, in order: **(1) close the M01 infra gaps against real services**, then **(2) build M02** per its milestone doc. Fable produced the runnable logic in a sandbox with no DB/auth/network; your job is to make it real and keep going.

**Golden rule (same as Fable's):** build to the specs in `/docs`; do **not** redesign the product. `CLAUDE.md` is the per-session contract — read it first, every session. If a spec is wrong, flag it and propose a fix; don't silently invent.

---

## 1. Read order (before writing code)
1. `CLAUDE.md` — invariants, DoD, CI gates, "when to stop and ask."
2. `docs/master-plan.md` (stack, glossary, milestone index) → `docs/architecture.md`.
3. `docs/decisions.md` — ADR-001/002/003 are **binding** (single-vendor Anthropic gateway w/ cheap+frontier tiers; M01 source = Greenhouse; freemium/$29 gating).
4. `docs/readiness-review.md` — known gaps/watch-items (all Sev-1 fixed; decisions resolved).
5. For M01 close-out: `docs/milestone-01.md` + `docs/milestone-01-workorder.md`.
6. For M02: `docs/milestone-02.md` + schema/api slices.

Authority order: **PRD (`CareerOS-Master-PRD-and-Architecture.md`, incl. Amendment A1 = the Career Intelligence Engine) > /docs > your assumptions.**

## 2. What already exists and is VERIFIED (don't rebuild)
Fable implemented, and I independently re-ran: **`pnpm -w test` → 10 files, 80/80 passing**, including both required security suites. Implemented + tested packages:

- `packages/config` — single zod env schema (the only sanctioned `process.env` read).
- `packages/contracts` — error model (incl. `capability_denied`, `source_not_allowed`), User/UserSettings/MeResponse with **conservative autonomy defaults**, canonical Opportunity, SourceRegistry entry.
- `packages/capability-gate` — tier registry (Green/Yellow/Red), HMAC `ApprovalToken` mint/verify bound to (userId, action, payloadHash), single-use + expiring, framework-agnostic `enforce()` + worker wrapper. **⚑ security suite green.**
- `packages/connectors` — `SourceConnector` interface, allow-list registry + guarded fetch (rejects non-allow-listed host **before** transport), Greenhouse fixture adapter, sanitizer + injection flags, dedup. **⚑ security suite green.**
- `packages/observability` — structured logger w/ PII redaction; immutable audit client over injectable sink; trace-id helper.
- `packages/llm-gateway` — tiered (cheap|frontier) provider abstraction per ADR-001, cost-metering hook, trace-id attach, `FakeLlmProvider`.
- `packages/db` — `prisma/schema.prisma` for all 11 M01 entities (pgvector cols, user_id scoping, provenance, cascades), WASM-validated. Seed = one enabled source (greenhouse).
- `apps/api` — `GET /v1/me`, `PATCH /v1/me/settings`, Yellow `DELETE /v1/me` as **framework-agnostic pure-function handlers** behind the gate; per-user scope helper. Tested with in-memory fakes.

**These interfaces are the contract.** When you replace a stub, implement *behind the existing interface* — don't change signatures unless you also update `docs/` in the same PR.

## 3. STUBS to replace with real implementations (this is most of your M01 close-out)
Each is marked `// STUB(M01):` in code. Map:

| Stub | Replace with |
|---|---|
| `capability-gate` `InMemoryApprovalTokenStore` | Prisma-backed `approval_tokens`; **consume must be atomic** (`UPDATE … WHERE consumed_at IS NULL`) |
| `connectors` `InMemorySourceRegistry` | Prisma-backed `source_registry` |
| `connectors` `liveHttpTransport` | Real HTTP transport w/ timeouts + `rate_policy` enforcement via Redis token bucket |
| `observability` `InMemoryAuditSink` | Prisma-backed append-only `audit_log` (immutable — no updates/deletes except account hard-delete) |
| `observability` `initTracing` | OpenTelemetry NodeSDK + OTLP exporter |
| `llm-gateway` `AnthropicProvider` | Real Anthropic Messages API adapter (keep `FakeLlmProvider` for tests) |
| `db` schema header / `src/index.ts` | `prisma migrate` + generated `PrismaClient` re-export |
| `apps/api` `contextFromVerifiedClaims` | Managed-auth (Clerk per ADR/`.env`) guard verifying bearer tokens |
| `apps/api` in-memory repos (identity) | Prisma repositories over `packages/db` |

## 4. M01 close-out task list (do these first — they gate M02's Definition of Ready)
1. **Provision infra (`infra/`, F01.8):** Terraform for Postgres+**pgvector**, Redis, S3-compatible storage, deploy target; Dockerfiles for `api`/`workers`/`web`. Local: docker-compose for Postgres+Redis+MinIO.
2. **DB live:** `prisma migrate dev` + run `packages/db/src/seed-data.ts` (seeds the one Greenhouse source). Verify migrate up/down clean.
3. **Swap the 4 in-memory stores** (token store, source registry, audit sink, identity repos) for Prisma implementations behind existing interfaces. Existing unit tests must stay green with fakes; add integration tests against a test DB.
4. **Auth:** wire Clerk guard → `RequestContext`; enforce per-user scope (user A can't read B — add the integration test).
5. **Boot NestJS:** bind the tested pure-function handlers + capability-gate interceptor into a real Nest module; `GET /v1/me`, `PATCH /v1/me/settings`, `DELETE /v1/me` served over HTTP.
6. **Real side-effecting endpoints:** `POST /v1/me/export` (enqueue via BullMQ) and hard-delete cascade end-to-end (delete owned rows + S3 artifacts + tokens).
7. **Ingestion worker (F01.6):** BullMQ consumer running the existing fetch→normalize→dedup→persist pipeline against the **live Greenhouse API** (real host, still through the allow-list guard). Idempotent (no dup Opportunities on re-run).
8. **Observability live:** OTel spans exporting; audit rows persisted; confirm every gate allow/deny is audited.
9. **CI (F01.1):** GitHub Actions running `pnpm -w test` + typecheck + lint + migration-check on every PR. Add the eslint **import-boundary rule** (`project-structure.md §2`) and confirm a deliberate cross-boundary import fails.
10. **Close DoD:** re-run the M01 demo path (sign in → live Greenhouse opportunity in DB → Yellow-without-token blocked + audited → non-allow-listed host rejected). Update `CLAUDE.md §10` to "M01 complete; M02 ready."

**Keep green throughout:** the two security suites (`capability-gate`, `connectors` allow-list) and all existing unit tests are permanent gates — never let them regress.

## 5. Then: start M02 (Identity, Career State Model & Knowledge Graph)
Follow `docs/milestone-02.md`. First deliverable before any agent code: **hand-author the extraction golden set** (`evals/extraction/`, 10–30 labeled resume cases) — the eval gate is meaningless without it (`coding-standards.md §4`). Then F02.1 (`POST /v1/profile/import` → extraction job via `llm-gateway` cheap tier, using `connectors/sanitize.ts` on the untrusted document text), then `packages/memory` + `packages/memory/graph` (`GraphMemoryService`) + `packages/cie/state` — design each behind fake-backed interfaces so logic stays testable without infra, exactly as M01 did.

## 6. Non-negotiable invariants (enforce in code — full list in `CLAUDE.md §3`)
Autonomy boundary (capability-gate on every side effect; Yellow needs a token; Red uncallable) · human-in-loop at consequence (never auto-submit/send/accept) · sanctioned sources only (allow-list; no scraping) · zero fabrication (release-blocking eval, lands in M03) · audit + provenance + model_version on everything · min-slice memory + tiered models + per-user cost budgets · privacy (per-user scoping, export + hard delete stay working, opt-in only for training/cross-user).

## 7. How to run what Fable built (verified commands)
```bash
# from repo root
corepack prepare pnpm@9.0.0 --activate
pnpm install --no-frozen-lockfile
pnpm -w test          # expect: 10 files, 80 tests passing (incl. 2 security suites)
pnpm --filter @careeros/db schema:validate   # WASM Prisma validation (no live DB)
```
Note: on a filesystem that forbids in-place `node_modules` deletion, mirror the repo elsewhere first. On a normal dev machine this just works.

## 7A. Starter kit already in the repo (use it — don't rewrite)
- `infra/docker-compose.yml` — Postgres+pgvector, Redis, MinIO (+ auto-created `careeros-artifacts` bucket) with healthchecks. `make up` or `docker compose -f infra/docker-compose.yml up -d`.
- `.github/workflows/ci.yml` — CI running install → typecheck → lint → prisma validate → `migrate deploy` → `pnpm -w test` against pg+redis services. This is the gate; keep it green.
- `packages/config/eslint.preset.mjs` — flat-config `base` + `agentBoundary`/`webBoundary`/`allowEnv` overlays implementing the import boundaries (project-structure.md §2). Wire each package's `eslint.config.mjs` to the right overlay (agents/cie → `agentBoundary`; web → `webBoundary`; config → `allowEnv`).
- `.env.local.example` — env for the docker stack (copy to `.env`). `Makefile` — `make bootstrap` / `up` / `db-migrate` / `db-seed` / `test`.
- **Local quickstart:** `make bootstrap && cp .env.local.example .env && make db-migrate db-seed test`.

## 8. Conventions Cursor must respect
- TypeScript strict, no `any`; shared types from `packages/contracts`; zod-validate all boundary input; ingested text is untrusted.
- Import boundaries (`project-structure.md §2`): `agents` never import `db`; only `memory`/`connectors` touch their stores; `web` never imports server/db; no cyclic deps; no `process.env` outside `packages/config`.
- Prisma migrations only (expand/contract, never one-step breaking). One skill-agent per folder (`agent.ts`/`prompt.ts`/`io.ts`/`agent.eval.ts`).
- Small PRs, Conventional Commits, each referencing its milestone + task id from `docs/task-board.md`; update touched docs in the same PR; **no PR crosses milestone scope.**

## 9. Stop-and-ask triggers (don't guess — these are product calls)
A spec contradicts another; an acceptance criterion isn't testable as written; an invariant would have to be weakened; or you hit something outside the resolved ADRs (e.g., a *new* source to add, a second LLM vendor, a pricing change). Surface it; don't invent.

## 10. Open items to be aware of (not blockers for M01/M02)
- 8AM-loop cost default (choose "top N=3, tailoring opt-in") — lands at M07.
- Second LLM vendor / active routing — deferred (ADR-001), revisit on cost data.
- Licensed aggregator source — post-wedge (ADR-002).
- Plugin sandbox (M10) is the biggest security surface — treat any escape as a launch blocker.

---

### One-paragraph kickoff (paste into Cursor)
> You're the implementation engineer for CareerOS. Read `CLAUDE.md`, `docs/cursor-handoff.md`, `docs/master-plan.md`, `docs/architecture.md`, and `docs/decisions.md`. Fable built the M01 runnable logic (80 tests green, incl. two security suites) with external infra stubbed. Your job: work `docs/cursor-handoff.md §4` top-to-bottom to close M01 against real Postgres+pgvector/Redis/S3/Clerk — replacing each `// STUB(M01):` behind its existing interface, keeping the two security suites and all unit tests green — then update `CLAUDE.md §10` and start M02 per `docs/milestone-02.md` (golden set first). Small PRs referencing task-board ids; enforce every invariant in `CLAUDE.md §3` as code; stop and ask on any spec contradiction or product decision outside the ADRs.
