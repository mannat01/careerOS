# M02 Work Order — Identity, Career State Model & Knowledge Graph (Fable execution brief)

**Executable brief for Milestone 02.** Expands `milestone-02.md` into an ordered, checkable sequence, scoped to what is **buildable + testable in the ephemeral sandbox** (pure logic behind fake-backed interfaces), with infra-dependent pieces explicitly deferred. Paste `§Kickoff prompt` to begin — **only after the repo is persistent (GitHub) and M01 code is present in the working tree.**

**Prereq (Definition of Ready):** the M01 packages exist and `pnpm -w test` is green (80/80). If starting from the zip, unzip and confirm tests pass first. Do NOT rebuild M01.

**Goal of M02:** bootstrap the CIE substrates. Turn a resume into structured, provenance-tagged Profile entities; stand up the four-tier `MemoryService`, the `GraphMemoryService`, and the `CareerStateModel` — all behind interfaces with in-memory + fake-LLM fakes so everything is unit/eval tested here. Demo (logic-level): given a fixture resume, produce structured entities + a connected career graph + a confidence-scored state model, all reproducible in tests.

---

## Build-here vs. defer (keep these piles separate; never mark deferred as done)
**Buildable + tested in sandbox (this work order):** golden dataset, extraction logic, memory tiers, graph service, state model, agents behind `FakeLlmProvider`, deterministic fake embedder, API handlers as pure functions, Prisma schema authoring.
**Deferred to real env (leave as `// STUB(M02):`, tracked in `docs/cursor-handoff.md`):** live pgvector reads/writes + migrations, a real embeddings provider, NestJS runtime boot, real file upload/parsing of binary PDF/DOCX at scale (use text fixtures here).

---

## Sequenced tasks

### 0. Golden set FIRST (F02.1 pre-req) — S · **do before any agent code**
- [ ] `evals/extraction/` — hand-author 12–20 labeled cases: raw resume text (fixtures, varied formats/messiness) → expected structured entities (experiences/skills/education) with provenance. Include 2–3 adversarial cases (embellishment bait) for the zero-fabrication precursor.
- [ ] `evals/state-model/` — 6–10 cases: a parsed profile → expected state dimensions with acceptable value/confidence ranges + required evidence links.
- **Accept:** eval harness loads both sets; a stub agent scores against them (red until real logic lands).

### 1. Resume extraction (F02.1) — L
- [ ] Extraction agent (`packages/agents` or `apps/workers/skill-agents/extractor`): resume **text** → structured `Experience/Project/Education/SkillClaim` with `provenance`, via `llm-gateway` **cheap tier** (use `FakeLlmProvider` in tests returning fixture completions) + deterministic post-parse/normalization. Sanitize input with `connectors/sanitize.ts` (untrusted text).
- [ ] `POST /v1/profile/import` handler (pure function; accepts text/parsed payload in sandbox) → enqueues/returns structured entities; profile CRUD handlers; edits emit `MemoryEvent`.
- **Accept:** extraction eval ≥90% recall on the golden set; every entity has provenance; adversarial cases produce **no fabricated facts**; edits persist authoritative + emit `MemoryEvent` (in-memory repo).

### 2. Memory service — four tiers (F02.2) — L
- [ ] `packages/memory` `MemoryService`: profile (structured + vector via fake embedder), episodic (`MemoryEvent` append-only), semantic (`DerivedInsight` regenerate), working (per-task slice). Hybrid retrieval + a **hard min-slice token budget**.
- **Accept:** `retrieve(task)` returns a bounded slice that provably never exceeds the budget and never returns full memory (unit test asserts both); insight regeneration is non-authoritative (drop/rebuild changes no source facts).

### 3. Knowledge graph (F02.3) — L
- [ ] `packages/memory/graph` `GraphMemoryService`: `GraphNode`/`GraphEdge` (in-memory store behind the interface), upsert from a parsed profile (experience→company, experience→skill, project→skill), multi-hop traversal + node vector retrieval (fake embedder).
- [ ] `GET /v1/cie/graph?node=&depth=&types=` handler.
- **Accept:** importing the fixture profile yields a connected graph; a depth-2 query from a skill node returns the expected neighborhood; upsert is idempotent (unit test).

### 4. Career State Model (F02.4) — L
- [ ] `packages/cie/state`: `CareerStateModel` + `CareerStateDimension`; `StateUpdater` agent derives ≥12 A1.1 dimensions, each with confidence + `evidence_refs` to graph nodes; **inferred vs demonstrated skills kept distinct**. `GET /v1/cie/state`, `/state/:dimension/explain`, `POST /state/recompute`.
- [ ] Change hook: editing a profile fact updates affected dimensions + records *why it moved* (`MemoryEvent`).
- **Accept:** state-model eval passes (dimensions grounded in real evidence, **zero fabrication**, inferred flagged distinct); an edit visibly moves a dimension with a logged reason.

### 5. Prisma schema for M02 entities (author only) — S
- [ ] Extend `packages/db/prisma/schema.prisma` with the `cie` tables from `database-schema.md` (`CareerStateModel`, `CareerStateDimension`, `GraphNode`, `GraphEdge`, `DerivedInsight`, `MemoryEvent`) incl. pgvector cols + indexes. `pnpm --filter @careeros/db schema:validate` green. **No live migration** (deferred).

### 6. Onboarding UI (F02.5) — M · *author, not runtime-verified in sandbox*
- [ ] `packages/ui`: `CareerStatePanel`, `ConfidenceBadge`, `ProvenanceTag`, `KnowledgeGraphExplorer` (component logic + stories; full render verified later). Wire a reflect-back screen in `apps/web` (imports only contracts/ui/config).

---

## Milestone-level DoD (logic-level, for this sandbox slice)
- [ ] `pnpm -w test` green including new extraction + state-model **eval gates** and all M01 tests (no regressions; the two M01 security suites still pass).
- [ ] Zero-fabrication holds across extraction + state model (adversarial golden cases pass).
- [ ] Prisma schema for M02 authored + validated.
- [ ] Every new agent behind `FakeLlmProvider`; every store behind an in-memory fake; all `// STUB(M02):` catalogued in the report.
- [ ] `docs/build-operating-model.md` build log + `CLAUDE.md §10` updated.
- [ ] Output committed to a branch and opened as a PR (never left only in the sandbox).

## Out of scope for M02
Resume tailoring/scoring (M03), discovery/pipeline (M04), reasoning/decision-support (M05). Do not build ahead.

---

## §Kickoff prompt (paste to Fable once the repo is persistent + M01 tests green)

> You are Claude Fable, implementation engineer for CareerOS. The repo is at <path/clone>. First confirm Definition of Ready: run `pnpm -w test` and verify M01 is green (80/80, incl. the capability-gate and connector allow-list security suites). Do NOT rebuild M01.
>
> Then read, in order: `CLAUDE.md`, `docs/build-operating-model.md`, `docs/master-plan.md`, `docs/architecture.md` (esp. §4A CIE services), `docs/decisions.md`, `docs/milestone-02.md`, `docs/milestone-02-workorder.md`, and the M02 slices of `docs/database-schema.md` + `docs/api-spec.md`.
>
> Execute `docs/milestone-02-workorder.md` top to bottom, one task per small PR referencing its task id (Epic E02 in `docs/task-board.md`). Authoring the golden sets (task 0) comes before any agent code. Build everything behind fake-backed interfaces (`FakeLlmProvider`, in-memory stores, a deterministic fake embedder) so it is unit/eval tested in this environment; leave live pgvector, real embeddings, and NestJS boot as `// STUB(M02):` and catalogue them. Keep all M01 tests green.
>
> Enforce every invariant in `CLAUDE.md §3` as code — especially zero fabrication (extraction + state model must invent nothing; adversarial golden cases must pass) and provenance + confidence + model_version on every entity and dimension. Stop and ask only on a spec contradiction, an untestable acceptance criterion, or a decision outside the ADRs. When the M02 logic-level DoD passes, update `docs/build-operating-model.md` + `CLAUDE.md §10` and return a report: what/where, test commands + results, every STUB(M02), what's deferred to real infra, and recommended M03 first steps.
