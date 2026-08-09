# CareerOS — Build Operating Model

How this project gets built using Opus + Fable (and other models), one milestone-slice at a time. Read this after `CLAUDE.md` when resuming work.

---

## 0. ⚠ LAUNCH-BLOCKER — Plugin sandbox hardening (public plugins)

**Status: MUST be resolved before enabling any untrusted third-party plugin.** Recorded as part of M10 Step 4 (plugin platform); reaffirmed at M10 Step 5 build closeout.

The M10 plugin platform ships with a `node:vm`-based sandbox intended for FIRST-PARTY / trusted reference plugins only. **`node:vm` is not a security boundary** — it isolates *scope*, not *process*. Known escapes (e.g. `this.constructor.constructor("return process")()` off any leaked object, prototype-chain climbing, timer/microtask races) let a malicious plugin reach:

- host **environment variables** (secrets, API keys, DB URLs),
- **filesystem** (arbitrary paths under the API/worker process),
- **outbound network** (bypasses the `SourceRegistry` allow-list at the network layer),
- the whole in-process Node runtime and every loaded module.

### Required before public plugins are enabled

Replace `node:vm` with a hardened isolate. Acceptable options, preferred → acceptable:

1. **Out-of-process isolate** — spawned worker process with `seccomp`/AppArmor, no filesystem, no network by default, IPC-only capability surface. Strongest boundary.
2. **`isolated-vm`** — V8 isolates with hard memory + CPU caps and no `require`/globals leakage.
3. **WASM / container** — `wasmtime` with WASI capabilities disabled, or per-invocation gVisor-style container.

### What is (and is not) currently protecting us

- Defense-in-depth **helps**: every plugin tool-call is host-scoped to the invoking `userId` (a plugin cannot address another user's data via the sanctioned tool API) and gated by the capability-gate (Green/Yellow/Red tiers, single-use `ApprovalToken` for Yellow).
- Defense-in-depth **does NOT** cover a `node:vm` escape: once code runs outside the sandbox, `process.env`, `fs`, `net`, and every loaded module are directly reachable. The capability-gate is a control on the sanctioned tool API — not on raw Node.

### Acceptance criteria to lift the blocker

- [ ] Sandbox replaced (option 1/2/3); `node:vm` no longer on any untrusted code path.
- [ ] `packages/agents/test/plugin-sandbox.security.test.ts` extended with engine-appropriate **escape attempts** (env exfiltration, `fs` reach, unsanctioned outbound network, prototype-chain escape, CPU/memory bomb) — all denied.
- [ ] Per-plugin CPU + wall-clock + memory caps enforced by the engine, not by cooperative timers.
- [ ] Outbound network from a plugin gated by the same `SourceRegistry` allow-list as the host, or disabled entirely.
- [ ] Recorded in the build log and this doc; the "public plugins" feature flag stays **OFF** until every box is checked.

Until then: only first-party plugins in the reference registry may be enabled, and only in trusted deployments.

---

## 0b. ⚠ LAUNCH-BLOCKER — PKM persistence is not backed by a real store

**Status: MUST be resolved before PKM ships to users.** Recorded at FM1 precheck (2026-07-28) after auditing the M10 Step 5 build closeout against the running database.

The M10 Step 5 build-log entry claimed a `PkmEntry` table with `userId` FK and `graphNodeIds jsonb` was landed per `docs/database-schema.md`. Audit finding: **no `Pkm*` model exists in `packages/db/prisma/schema.prisma`, no `pkm*` symbol exists in `packages/db/src`, and no `pkm_*` table exists in the running Postgres.** The empty migration directory `packages/db/prisma/migrations/20260727000000_m10_pkm/` (no `migration.sql`) is the surviving fingerprint of the aborted work — its presence also breaks `prisma migrate deploy` on every clean checkout (`P3015`).

What actually shipped for M10 PKM:
- `packages/cie/pkm/src/{ports,fakes,service}.ts` — `PkmStorePort` + `PkmGraphIngestPort` interfaces with **in-memory fakes**.
- `apps/api/src/modules/cie/pkm.handlers.ts` + `apps/api/src/app/pkm.controller.ts` — wired to the fake in `apps/api/src/app/deps.ts`.
- `packages/cie/pkm/test/pkm.integrity.test.ts` and `apps/api/test/cie-pkm.handlers.test.ts` — pass against the fakes.

That means PKM writes today do not persist across process restarts, and the M10 Step 5 report overstated persistence.

### Acceptance criteria to lift the blocker

- [ ] `PkmEntry` model added to `packages/db/prisma/schema.prisma` matching `docs/database-schema.md`.
- [ ] Real migration generated (`prisma migrate dev --name m10_pkm`) that produces the promised table + indexes; empty `20260727000000_m10_pkm/` directory removed.
- [ ] `PrismaPkmStore` implementing `PkmStorePort` added under `packages/db/src/stores/`, wired in `apps/api/src/app/deps.ts` (fake retained only for tests).
- [ ] `apps/api/test/cie-pkm.handlers.test.ts` (or an integration variant) exercised against Postgres, not only the fake.
- [ ] Build log updated with the fix.

Until then: PKM endpoints remain "wired but non-durable" and MUST NOT be surfaced in any FM shipping to real users. FM1 does not build PKM UI — it only ships placeholder room pages — so FM1 can proceed on the M01–M09 schema, which is complete and durable.

### FM1 immediate action

The empty `packages/db/prisma/migrations/20260727000000_m10_pkm/` directory is being removed in the FM1 precheck commit because it blocks `prisma migrate deploy` on a clean clone. Removing the directory does **not** discharge this blocker — the acceptance criteria above are what does.

---

## 0c. FM1 closure — deferred-risk register

These risks are explicitly deferred beyond the `fm1-baseline` tag at commit
`731fde7`. They do not reopen FM1, but they must remain visible and must not be
silently treated as complete by later frontend milestones.

| Risk | Current boundary | Exit condition |
|---|---|---|
| **Production Clerk authentication** | FM1 is fully verified with dev JWT auth; the production build validates Clerk-shaped configuration, but no live Clerk sign-in/refresh session has been exercised. | Staging Clerk sign-in, guarded shell, refresh/re-auth, sign-out, and backend token verification pass end-to-end without a dev-auth fallback. |
| **Cross-browser Playwright coverage** | The blocking real-stack smoke runs Chromium only. | The same auth + `/rt/twin` Green completion and Yellow halt pass in Firefox and WebKit as blocking CI projects. |
| **Existing DB/API integration skips** | The FM1 baseline retains the repository's established environment-gated skips (local closure run: DB 18 skipped; API 34 skipped). No FM1 test weakened or added a skip. | Canonical integration configuration supplies required infra consistently and every intended DB/API integration test executes in local full parity and CI with zero unexpected skips. |
| **Real-model validation — Track B** | Fake providers prove deterministic contracts, guardrails, SSE behavior, and eval plumbing; they do not establish real-provider output quality. | Run the existing golden/eval gates against the production candidate model/provider, review calibration/cost/latency, and record an explicit launch decision. |
| **Hardened plugin isolation — launch blocker** | First-party trusted plugins only; `node:vm` is not a security boundary. | Satisfy the isolation and escape-test criteria in §0 before enabling untrusted third-party plugins. |
| **Real PKM persistence — launch blocker** | PKM remains non-durable and must not be exposed as a shipping UI. | Satisfy the Prisma migration/store/integration criteria in §0b before PKM ships. |

---

## 1. Roles
- **Opus (orchestrator/architect/reviewer):** scopes each work unit, makes trade-off + security + product calls, writes/updates specs, and **independently verifies** every implementation (re-runs tests, reads diffs). Does not hand cheaper models any decision that changes architecture, security, or product scope.
- **Fable (implementer):** writes real, tested code for one scoped slice at a time, following `/docs` + `CLAUDE.md`. Reports what it ran and what it stubbed. Never marks infra-dependent work "verified."
- **Mid-tier model (optional):** mechanical work only — renames, boilerplate, doc formatting, test fixtures — when neither depth nor cost justifies Opus/Fable.

## 2. What can vs. can't be done in this build environment
This environment has Node + npm registry access, so **buildable + testable here**: pure logic, interfaces, agents behind a fake LLM provider, in-memory store fakes, unit/eval/security suites (`pnpm -w test`), Prisma schema authoring + WASM validation.

**Needs a real environment (queued, not done here):** live Postgres/pgvector + migrations, Docker/compose, Redis-backed queues at runtime, managed auth (Clerk), live external API calls, OTel export, CI actually executing on a push. These are tracked as `// STUB(Mxx):` in code and closed via `docs/cursor-handoff.md` on a real machine.

**Rule:** a slice is "logic-complete" when its tests are green here; it is only "milestone-complete" when its infra stubs are replaced and verified in a real environment. Keep the two states distinct in the build log and in `CLAUDE.md §10`.

## 3. Per-slice loop (Opus + Fable)
1. **Opus** picks the next buildable slice from `task-board.md`, writes/refreshes any needed spec detail, and briefs Fable with exact scope + guardrails + a fake-backed testing requirement.
2. **Fable** implements behind existing interfaces, keeps all prior tests green, adds new unit/eval/security tests, and returns a report (what/where, tests run + results, stubs, not-done, next steps).
3. **Opus** independently re-runs `pnpm -w test`, reads the diff, checks invariants (capability-gate, sanctioned sources, zero-fabrication, provenance/confidence), and either accepts or sends corrections.
4. **Opus** updates the build log (§5) + `CLAUDE.md §10`, then repeats.

## 4. Session-resume protocol (sessions here reset; agents start cold)
On a fresh session: read `CLAUDE.md` → `docs/build-operating-model.md` (this file, incl. the build log) → the current `milestone-NN.md`. The build log is the source of truth for "where we are." Re-verify by running the test suite before building further.

## 5. Build log (update every slice)
| Date | Slice | Model | Logic-complete (tests green here) | Infra stubs remaining | Verified by Opus |
|---|---|---|---|---|---|
| 2026-08-09 | **FM1 — Foundation + Trust Kit: COMPLETE (Task 9).** Six guarantees consolidated as a named blocking suite; schema-parsed `@careeros/contracts` MSW fixtures; all current route states axe/keyboard gated; real dev-auth + fake-LLM Playwright smoke through canonical `/rt/twin` SSE; CI/local full parity wired. | Cline | ✅ guarantees 6/6 · fixtures 3/3 · axe/keyboard 19/19 · Playwright 1/1 · workspace 970 · frontend 192 · eval CI 216 · production build + `make verify` green | Managed Clerk remains the declared FM1 auth follow-up; no FM2 work started. Existing DB/API integration config skips unchanged. | ✅ full parity + diff check |
| 2026-07-08 | M01 Foundations (config, contracts, capability-gate, connectors, observability, llm-gateway, db schema, api handlers) | Fable | ✅ 80/80 tests, 2 security suites | pg/redis/s3/clerk/otel/live-http/nest-boot | ✅ re-ran, 80/80 |
| 2026-07-08 | M01 starter kit (docker-compose, CI, eslint boundaries, Makefile) | Opus | ✅ YAML+preset validated | CI unproven until a real push | ✅ |
| 2026-07-09 | M01 re-verified on user machine (VS Code + Cline + Fable via OmniRoute) | Fable | ✅ 80/80, both security suites | (unchanged — infra close-out next) | ✅ report reviewed |
| 2026-07-09 | M01 Step 3a: initial `init_m01` migration + seed against live Postgres (compose pg/redis/minio all healthy; seed → 1 enabled source `greenhouse`; re-run `migrate deploy` = no-op) | Cline | ✅ 80/80 still green | redis-runtime/clerk/otel/nest-boot | _pending_ |
| 2026-07-09 | M01 Step 3b: Prisma-backed stores + db integration suite against live Postgres; dev+clerk auth providers behind `resolveBearerToken`; per-user scoping tests; CI runs migrate deploy + seed + integration | Cline | ✅ 96 unit (DB-free) + 8 integration | clerk-live/otel/nest-boot | ✅ merged to main |
| 2026-07-10 | **M01 Step 3c: NestJS booted + live M01 endpoints — M01 CLOSED.** Composition root (`buildDepsFromEnv`: Prisma stores, DevAuth, BullMQ export queue, MinIO-or-fake ObjectStorage), `BearerAuthGuard`, `MeController` (GET /v1/me, PATCH settings, Yellow DELETE with full hard-delete cascade, Green POST export), 9 supertest e2e wired into CI (in-memory storage fake — no MinIO in CI). Verified on docker pg+redis+minio: 96 unit + 8 db-int + 9 e2e green; typecheck/lint/madge clean; live curl demo passed (GET /v1/me 200 with minted token; DELETE w/o approval → 403 capability_denied; no auth → 401) | Cline | ✅ all suites green | clerk-live/otel/export-worker/live-ingestion/terraform → queued M02+ | _pending_ |
| 2026-07-10 | M01 tidy-up: type-aware ESLint re-enabled (`recommendedTypeChecked` + `projectService` in the shared preset). Triaged findings fixed properly (no suppressions): enforce.ts `AuditWriter.append` return `Promise<unknown> \| unknown` → `unknown` (redundant union); gate security test dropped an unnecessary `as AuditEntry` cast; trace.ts `initTracing` now consumes its opts (echoes `serviceName`). Type-aware lint also surfaced + fixed: 9 unnecessary Prisma casts in @careeros/db, `require-await` in ClerkAuthProvider stub, `any` leaks in MinIO stream iteration + e2e `res.body` (typed `body<T>()` helper at the HTTP boundary) | Cline | ✅ 96 unit + 8 db-int + 9 e2e; lint/typecheck/madge clean | (unchanged) | _pending_ |
| 2026-07-10 | **M02 Step 1 (workorder Task 0): golden datasets authored FIRST.** `@careeros/evals`: extraction golden set — 15 cases (2 chronological, 2 functional, 2 bullet-heavy, 2 sparse, 2 career-changer, 2 non-linear + 3 adversarial embellishment traps with `forbidden` strings + trap notes); state-model golden set — 8 cases (confidence bands + required evidence refs; sm-05/06 police demonstrated-vs-inferred, sm-07 ungrounded dimensions). Harness (`src/harness.ts`): recall + verbatim-provenance gate + fabrication gate; oracle/stub self-tests. Eval gate (`pnpm --filter @careeros/evals eval`) runs stub agents → RED by design (23 failed / 3 passed) until Step 2; excluded from `pnpm -w test`. 24 integrity+harness tests added to the DB-free suite | Cline | ✅ 120 unit (was 96) + 8 db-int + 9 e2e; lint/typecheck/madge clean | real extractor + StateUpdater (Steps 2/4) flip the gate green | _pending_ |
| _next_ | M02 Step 2: extraction agent (F02.1) behind FakeLlmProvider | Fable/Cline | _queued_ | — | _pending_ |

### Follow-ups (queued)
- Prisma migrations use snake_case table names (`source_registry` etc.) via `@@map`; raw SQL queries must use the mapped names.
- Seed script (`packages/db/src/seed.ts`) is idempotent (upsert by `key`); keep it that way as sources are added.
- CI now runs the full chain: madge → prisma generate → typecheck → lint → schema validate → migrate deploy → seed → db integration → api e2e → unit suites.
- A `me-export` worker (consuming the BullMQ queue and writing the export artifact to object storage) is queued for M02.

**Execution surface (current):** VS Code + Cline extension running Fable 5 via OmniRoute, on the user's machine (real infra available). Opus reviews at each 🛑 gate in `docs/cline-runbook.md`.
**Doc-sync note:** these docs postdate `careeros-m01-plus-starterkit.zip` and must be added to the repo's `docs/`: build-operating-model.md, github-setup.md, milestone-02-workorder.md, omniroute-guide.md, cline-runbook.md.

## 6. Guardrails that never relax regardless of model
Autonomy boundary in code · human-in-loop at consequence · sanctioned sources only · zero fabrication (release-gated) · audit + provenance + confidence + model_version on every artifact · min-slice memory + tiered models + cost budgets · privacy (scoping, export, hard delete, opt-in only). Any model that would weaken one of these must stop and surface it, not proceed.
