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

## 6. Golden-dataset rule (greenfield)
No historical data exists. An agent's **first** deliverable is its hand-authored golden set (10–30 labeled cases) under `evals/<agent>/`, committed before the agent logic. An eval gate with no dataset is not "done."

## 7. Code rules (the ones most often violated)
- TypeScript strict; no `any`. Shared types come from `packages/contracts`; validate all boundary input with zod. **Ingested source text is untrusted** — sanitize before it reaches an LLM.
- Respect package import boundaries (`project-structure.md §2`): `agents` never import `db`; only `memory`/`connectors` touch their stores; `web` never imports server/db packages. No cyclic deps. No `process.env` outside `packages/config`.
- One skill-agent per folder: `agent.ts`, `prompt.ts`, `io.ts` (zod), `agent.eval.ts`. Prompts are versioned; changing one requires its eval to pass.
- Migrations via Prisma only, expand/contract, never one-step breaking.

## 8. Git & PR
- Trunk-based, small PRs, Conventional Commits. Each PR references its milestone + task id from `task-board.md`.
- No PR crosses milestone scope. Update affected docs in the same PR.

## 9. When to stop and ask (don't guess)
Stop and surface a question if: a spec contradicts another spec; an acceptance criterion isn't testable as written; an invariant would have to be weakened to proceed; or a `[Decision]` item from `docs/readiness-review.md` blocks you (LLM vendor strategy, source mix, pricing/free-tier gating). These are product calls, not yours to invent.

## 10. Current status
- Milestone in progress: **M01 — Foundations** (see `docs/milestone-01.md` + `docs/milestone-01-workorder.md`).
- **M01 progress (2026-07-08, sandbox build — pure logic + interfaces, infra stubbed):**
  - DONE (implemented + tested, `pnpm -w test` green — 80 tests / 10 files):
    - `packages/config` — single zod env schema; only sanctioned `process.env` read.
    - `packages/contracts` — error model (incl. `capability_denied`, `source_not_allowed`), User/UserSettings/MeResponse (conservative autonomy defaults), canonical Opportunity, SourceRegistry entry.
    - `packages/capability-gate` — tier registry (Green/Yellow/Red), ApprovalToken mint/verify bound to (userId, action, payloadHash), single-use + expiring, framework-agnostic `enforce()` + worker tool-call wrapper. ⚑ Required security suite green (Yellow w/o token denied; invalid/expired/mismatch/replay denied; Red has no allowed path; fail-closed on unknown actions).
    - `packages/connectors` — `SourceConnector` interface, allow-list registry + guarded fetch (rejects non-allow-listed hosts BEFORE transport), Greenhouse adapter (fixture-driven, per ADR-002), sanitizer + injection flags, dedup. ⚑ Required allow-list security suite green.
    - `packages/observability` — structured logger with PII redaction; immutable audit client with injectable sink; trace-id helper (OTel init stubbed).
    - `packages/llm-gateway` — tiered (cheap|frontier) provider abstraction per ADR-001, cost-metering hook, trace-id attach, FakeLlmProvider; Anthropic adapter stubbed.
    - `packages/db` — `prisma/schema.prisma` authored for all 11 M01 entities (pgvector columns, user_id scoping, provenance, cascades); validated via `pnpm --filter @careeros/db schema:validate` (WASM validator; no live DB). SourceRegistry seed = exactly one enabled source (greenhouse).
    - `apps/api` — `GET /v1/me`, `PATCH /v1/me/settings`, Yellow `DELETE /v1/me` behind the capability-gate wrapper; per-user scope helper. Handlers are framework-agnostic pure functions (NestJS runtime not booted offline); tested with in-memory fakes.
  - NOT DONE (needs real infra/network — grep `STUB(M01)`): live Postgres migration up/down + seed run, managed-auth (Clerk) integration, BullMQ ingestion worker wiring, live Greenhouse fetch, `POST /v1/me/export` job, OTel exporter, Terraform/CI (F01.8), NestJS app bootstrap, eslint import-boundary rule.
- Update this section at each milestone handoff.
