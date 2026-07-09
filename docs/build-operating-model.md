# CareerOS — Build Operating Model

How this project gets built using Opus + Fable (and other models), one milestone-slice at a time. Read this after `CLAUDE.md` when resuming work.

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
| 2026-07-08 | M01 Foundations (config, contracts, capability-gate, connectors, observability, llm-gateway, db schema, api handlers) | Fable | ✅ 80/80 tests, 2 security suites | pg/redis/s3/clerk/otel/live-http/nest-boot | ✅ re-ran, 80/80 |
| 2026-07-08 | M01 starter kit (docker-compose, CI, eslint boundaries, Makefile) | Opus | ✅ YAML+preset validated | CI unproven until a real push | ✅ |
| 2026-07-09 | M01 re-verified on user machine (VS Code + Cline + Fable via OmniRoute) | Fable | ✅ 80/80, both security suites | (unchanged — infra close-out next) | ✅ report reviewed |
| _next_ | M01 infra close-out (Cline runbook Step 3a–d) → then M02 core slice | Fable/Cline | _queued_ | pg/redis/clerk/otel/nest-boot | _pending_ |

**Execution surface (current):** VS Code + Cline extension running Fable 5 via OmniRoute, on the user's machine (real infra available). Opus reviews at each 🛑 gate in `docs/cline-runbook.md`.
**Doc-sync note:** these docs postdate `careeros-m01-plus-starterkit.zip` and must be added to the repo's `docs/`: build-operating-model.md, github-setup.md, milestone-02-workorder.md, omniroute-guide.md, cline-runbook.md.

## 6. Guardrails that never relax regardless of model
Autonomy boundary in code · human-in-loop at consequence · sanctioned sources only · zero fabrication (release-gated) · audit + provenance + confidence + model_version on every artifact · min-slice memory + tiered models + cost budgets · privacy (scoping, export, hard delete, opt-in only). Any model that would weaken one of these must stop and surface it, not proceed.
