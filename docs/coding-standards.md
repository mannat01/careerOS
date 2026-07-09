# CareerOS — Coding Standards

**Applies to:** every package/app. Enforced in CI; violations block merge. Written so Claude Fable can self-check before opening a PR.

---

## 1. Language & types

- TypeScript `strict` everywhere; no `any` (use `unknown` + narrowing). No non-null `!` except with a comment justifying it.
- Shared types come from `packages/contracts` (zod schemas → inferred types). Do not re-declare DTOs locally.
- Validate all external input (HTTP bodies, tool I/O, ingested source data) with zod at the boundary. Ingested source text is **untrusted** — sanitize before it reaches an LLM.

## 2. Architecture rules (lint-enforced where possible)

- Respect package import boundaries in `project-structure.md §2`. No cyclic deps.
- No cross-domain DB access; go through the owning module's service. `agents` never touch `db`; only `memory`/`connectors` touch their respective external stores.
- No `process.env` outside `packages/config` env schema.
- Every side-effecting action routes through the capability-gate. No tool executes a Yellow/Red action without a valid token — a prompt instruction is never the control.

## 3. Agent/LLM code

- One skill-agent per folder: `agent.ts`, `prompt.ts`, `io.ts` (zod I/O), `agent.eval.ts`. Deterministic seams (parsing, scoring math) are unit-tested separately from the LLM call.
- Every LLM call goes through `packages/llm-gateway`: declares model tier (cheap|frontier), attaches cost metering + trace id, and passes **min-slice** context (no full-memory dumps).
- **Zero fabrication:** agents that touch resume/profile output must only use real profile facts; enforced by the M03 eval gate. Never synthesize experience/credentials.
- Prompts are versioned; changing a prompt requires its eval suite to pass (regression gate).

## 4. Testing (gates)

- **Unit + integration** (Vitest/Jest) for domain logic and services; deterministic parts of agents.
- **Contract tests** validate API responses + WS events against `contracts` schemas.
- **Eval gates** (Promptfoo/Langfuse): per-skill-agent regression + the global zero-fabrication eval. Must be green to merge changes to prompts/agents.
- **Golden-dataset bootstrap (greenfield):** there is no historical data at M0. Each agent's *first* deliverable is a hand-authored golden set (10–30 labeled cases) committed under `evals/<agent>/` before the agent's logic is written — the eval gate is meaningless without it. Extraction/state golden sets are authored in M02, tailoring/scoring/zero-fabrication in M03, decision-support/calibration in M05. Expand these from real (opt-in, de-identified) data once available (M10).
- **Security tests:** capability-gate (Yellow/Red cannot execute without/with-invalid token) and source allow-list (non-allow-listed host blocked) — required from M01.
- **E2E** (Playwright) for the wedge demo path and the briefing approval flow.
- **a11y** (axe) in CI blocks on AA violations.
- Coverage is a signal, not a target; critical paths (capability-gate, memory, tailoring, briefing) require tests.

## 5. Git & review

- Trunk-based; short-lived branches; small PRs. Conventional Commits (`feat:`, `fix:`, `chore:`…).
- Every PR: passes all CI gates; updates affected docs (schema/api/milestone changelog) in the same PR; references the milestone + task id from `task-board.md`.
- No PR crosses milestone scope. Migrations use expand/contract; never a breaking one-step change.

## 6. Observability & errors

- Structured logs (no PII in logs). OTel span around every agent step + tool call, tied to `BriefingRun`/`AuditLog` ids.
- Use the shared error model (`api-spec.md §2`); surface `traceId` to clients. Fail loud in dev, degrade gracefully in prod (partial briefing over blank screen).

## 7. Performance & cost

- Cache/dedup expensive work (a posting parsed/embedded once, globally). Respect per-user LLM budget caps. Prefer cheap models for extract/score/rank; reserve frontier models for generation/coaching. Batch overnight loop work.

## 8. Security & privacy defaults

- Least privilege everywhere. Encrypt sensitive PII at field level; encrypt OAuth tokens. Never train on user data without opt-in. Full export + hard delete must keep working (tested). Autonomy defaults ship conservative.
