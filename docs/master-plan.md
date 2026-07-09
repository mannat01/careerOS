# CareerOS — Engineering Master Plan

**Status:** Implementation source of truth (derived from *CareerOS Master PRD & System Architecture v1.0*)
**Rule:** This plan does **not** redesign the product. The PRD is authoritative for *what/why*; this doc set is authoritative for *how we build it*. If this plan and the PRD disagree, the PRD wins and this plan is corrected.
**Optimized for:** Claude Fable executing **one milestone at a time**. Each milestone doc is a self-contained work order.

---

## 1. Assumed tech stack (override in ONE place)

The PRD fixed the *shape* (modular monolith + separate agent/ingestion workers, relational + vector store, tiered LLMs) but not vendors. These are the committed defaults. To change the stack, edit this section and `architecture.md §Stack`; the rest of the docs reference those, not hard-coded vendors.

| Concern | Choice | Notes |
|---|---|---|
| Language | **TypeScript** everywhere | One language across web, API, workers, evals |
| Monorepo | **Turborepo + pnpm** | Shared packages, task caching |
| Frontend | **Next.js (App Router) + React**, Tailwind, **shadcn/ui** + Radix, TanStack Query, Zustand, Framer Motion | See `design-system.md`, `component-library.md` |
| API/BFF | **NestJS** (modular monolith) | REST + WebSocket/SSE streaming; module seams = future service boundaries |
| Workers | **NestJS standalone + BullMQ** consumers | Agent runs + ingestion; never in the request path |
| DB | **PostgreSQL** + **pgvector** | Single store early; `MemoryService` abstracts vector so it can move to a dedicated store later |
| ORM | **Prisma** | Migrations are the schema source of truth |
| Cache/Queue | **Redis** + **BullMQ** | Scheduler, job queue, rate limits, idempotency keys |
| Object storage | **S3-compatible** | Rendered resumes, exports |
| Auth | **Managed provider (Clerk / WorkOS)** | SSO, passkeys, MFA — never roll our own |
| LLM access | **Internal LLM Gateway** (multi-provider) | Anthropic primary + a cheap/fast tier model; routing, caching, cost metering |
| LLM observability/evals | **Langfuse (or Helicone) + Promptfoo** | Traces, cost, regression-gated evals |
| Telemetry | **OpenTelemetry** + structured logs | Distributed traces across agent steps |
| IaC / deploy | **Terraform** + containers on managed K8s/PaaS | |
| CI/CD | GitHub Actions | Lint, typecheck, test, eval-gate, migrate, deploy |

Anything not on the **sanctioned-source allow-list** (PRD §3.9) is blocked at the connector layer. This is a build constraint, not a preference.

## 1A. Glossary (avoid confusion during execution)

- **CIE (Career Intelligence Engine)** — the central intelligence platform (PRD Part II-A). Supersedes the old "AI Career Twin" as the *intelligence layer*.
- **Twin** — the **conversational surface** of the CIE (the voice at ⌘K / `WS /rt/twin`). Not a separate system. When older text says "the Twin does X" as intelligence, read "the CIE."
- **Skill-agent** — a bounded, individually-eval'd agent (Tailor, Scorer, StrategicReasoner, Planner, …). **Autonomy tiers** — Green (auto/advisory), Yellow (approve-then-act), Red (never automated).
- **Career State Model** — the confidence-scored, evidence-linked dynamic model of the user. **Knowledge Graph** — memory as connected nodes/edges the CIE reasons across.
- **Material change** — the threshold that triggers plan regeneration (defined in `architecture.md §4A`).
- **DoR/DoD** — Definition of Ready / Done (§7). **Wedge** — the standalone launch product, M01–M05.

## 2. Document map

| Doc | Purpose |
|---|---|
| `master-plan.md` | This file — stack, phasing, milestone index, execution protocol |
| `architecture.md` | System design, layers, agent architecture, cross-cutting concerns |
| `database-schema.md` | Entities, columns, relations, indexes, Prisma model plan, migrations |
| `api-spec.md` | REST/WS contracts, auth, error model, versioning |
| `project-structure.md` | Monorepo layout, package boundaries, naming |
| `coding-standards.md` | Language, lint, testing, git, review, agent-code rules |
| `design-system.md` | Tokens, color, type, motion, a11y |
| `component-library.md` | Component inventory, props, states |
| `task-board.md` | Prioritized backlog: Epics → Features → Tasks → Subtasks |
| `milestone-01.md`…`milestone-10.md` | Self-contained work orders, one per milestone |

## 3. Milestone index (maps to PRD build sequence + Amendment A1 — the CIE)

Ten milestones. The CIE (PRD Part II-A) is woven in from M02 (state model + graph) and becomes the central platform in M05–M08. This is an *evolution* of the original 8-milestone plan, not a re-plan: M01/M03 are unchanged; M02/M04 are extended; the old "Twin surface" milestone becomes the "CIE Reasoning Core"; three CIE-specific milestones (M06 Planner, M07 Research, M08 Dashboards) are inserted; growth and compound shift to M09/M10.

| # | Milestone | PRD ref | Ships | Depends on |
|---|---|---|---|---|
| **M01** | Foundations | §Phase 0 | Infra, auth, data core, observability+audit, capability-gate, first sanctioned source E2E | — |
| **M02** | Identity, Career State Model & Knowledge Graph | §Phase 1, A1.1–A1.2 | Resume import → structured Profile; four-tier memory; **graph layer + Career State Model bootstrap** | M01 |
| **M03** | Resume Intelligence | §Phase 1 | Structured resume model, ATS render, tailoring, explained match, zero-fabrication gate | M02 |
| **M04** | Discovery, Pipeline & Graph Ingestion | §Phase 1, A1.2 | Ingestion connectors, canonical Opportunity, scoring+explanation, Application CRM, **graph upsert** | M01, M02 |
| **M05** | CIE Reasoning Core & Decision Support | §7, A1.3 | Strategic reasoner (evidence→reasoning→confidence contract), decision/offer comparison, **Twin conversational surface (⌘K)**, manual briefing | M02, M03, M04 |
| **M06** | Career Strategy Planner | A1.4 | Adaptive 30d/90d/1y/3y/5y plans, auto-regeneration, "today's move" | M05 |
| **M07** | Autonomous Research + Scheduled Automation | §8, A1.5 | Research agents (sanctioned/licensed only), scheduled 8AM loop, approval queue, audit UI, autonomy tiers live | M05, M06 |
| **M08** | Intelligence Dashboards | A1.6, §12 | Momentum/readiness/positioning/salary/etc. metrics, each explained + drill-down + plan-linked | M06, M07 |
| **M09** | Growth Surfaces | §Phase 2 | Interview prep, skill development, cover/outreach drafts, public portfolio | M03, M04, M05 |
| **M10** | Compound & Extend | §Phase 3, §19 | Opt-in cross-user market intel + calibration, negotiation/offer intelligence, plugin contract, PKM | M07, M08, M09 |

M01→M05 deliver the standalone wedge with a reasoning core. M06–M08 make CareerOS a *strategist* (plans, research, legible trajectory). M09–M10 deepen and compound. Invariants (autonomy-in-code, human-in-loop, sanctioned-sources, zero-fabrication) hold across all ten.

## 4. Execution protocol for Fable (one milestone at a time)

1. **Read** `master-plan.md` + `architecture.md` + the current `milestone-NN.md` + relevant sections of `database-schema.md`/`api-spec.md`.
2. **Confirm gate:** all `Dependencies` of the milestone are `Done` on `task-board.md`.
3. **Execute** the milestone's Tasks/Subtasks from `task-board.md` in listed order. Do not pull work from a later milestone.
4. **Definition of Done per milestone:** every `Acceptance criteria` bullet demonstrably passes; every `Testing requirements` item exists and is green in CI (including eval gates where specified); docs touched are updated; the milestone's demo path works end-to-end.
5. **No cross-milestone scope creep.** If a task reveals missing work, add it to the backlog under the right milestone rather than expanding the current one.
6. **Amend, don't drift.** If reality forces a change to a contract in `database-schema.md`/`api-spec.md`, update that doc in the same PR and note it in the milestone's changelog.

## 5. Cross-cutting invariants (enforced in every milestone)

- **Autonomy boundary in code (PRD §7.3):** every tool/side-effecting action passes the capability-gate; Yellow/Red actions require a valid approval token. Covered by an automated security test from M01 onward.
- **Zero fabrication:** the Twin never invents credentials/experience. Enforced by an eval gate (M03) that blocks release.
- **Sanctioned sources only (PRD §3.9):** connector allow-list; anything else blocked. Security-tested.
- **Auditability:** every Twin action logged immutably to the `BriefingRun`/audit trail from the first agent action.
- **Min-slice memory & tiered models:** no full-memory context dumps; cheap models for extraction/scoring, frontier for generation. Cost metered per call.
- **Privacy:** per-user data scoping, full export + hard delete are first-class from M01.

## 6. Estimation legend

Complexity is **T-shirt (S/M/L/XL)** per milestone and per task, plus a rough engineer-week band. These are planning aids, not commitments; Fable executes to acceptance criteria, not to hours.

- S ≈ ≤3 eng-days · M ≈ 0.5–1.5 eng-weeks · L ≈ 1.5–3 eng-weeks · XL ≈ 3–6 eng-weeks.

## 7. Definition of Ready / Done (global)

**Ready:** dependencies Done; contracts (DB/API) referenced exist or are specified in-milestone; acceptance criteria are testable.
**Done:** acceptance criteria pass; tests + eval gates green; observability/audit emitting; docs updated; demo path verified; no Sev-1/Sev-2 known defects.
