# CareerOS — Architecture

**Derived from:** PRD §13–§19. This document is the technical realization of the PRD's architecture; it adds no new product scope.

---

## 1. Stack (canonical reference)

See `master-plan.md §1`. All other docs reference stack roles (Web, API, Worker, DB, Vector, Queue, LLM Gateway) rather than vendors so the stack can be swapped in one place.

## 2. Runtime topology

```
                          ┌──────────────────────────┐
   Browser (PWA)  ───────▶│  Web app (Next.js)       │
                          └────────────┬─────────────┘
                                       │ HTTPS / WSS (typed client)
                          ┌────────────▼─────────────┐
                          │  API / BFF (NestJS)      │  REST + WS/SSE stream
                          │  authN/Z · rate limit    │
                          │  capability-gate (sync)  │
                          └───┬───────────────┬──────┘
             internal calls   │               │  enqueue jobs
        ┌───────────────────▼──┐        ┌─────▼──────────────────┐
        │ Core domain modules  │        │  Redis + BullMQ queues │
        │ Identity/Profile     │        └─────┬──────────────────┘
        │ Resume · Opportunity │              │ consume
        │ Application · Prep   │        ┌─────▼──────────────────┐
        │ Analytics            │        │  Workers (NestJS)      │
        └───────┬──────────────┘        │  • Agent orchestrator  │
                │                        │  • Skill-agents        │
                │                        │  • Ingestion connectors│
                │                        │  • Scheduler (8AM)     │
                │                        └───┬────────────┬───────┘
                │                            │            │
        ┌───────▼──────────┐   ┌─────────────▼──┐   ┌────▼─────────────┐
        │ Postgres+pgvector│   │  LLM Gateway   │   │ Sanctioned source│
        │ + S3 + audit log │   │ (multi-vendor) │   │ connectors (API) │
        └──────────────────┘   └────────────────┘   └──────────────────┘
                                       │
                              ┌────────▼─────────┐
                              │ Langfuse traces  │
                              │ + cost metering  │
                              └──────────────────┘
```

**Golden rule:** agent runs and ingestion are **async jobs**, never in the HTTP request path. Chat/streaming uses WS/SSE but still dispatches heavy steps to workers. The 8AM briefing is assembled overnight and read in the morning; the user never waits on the loop (PRD §13).

## 3. Layers & responsibilities

- **Web (Next.js):** rendering, optimistic UI, streaming Twin responses, ⌘K command surface. No business logic beyond presentation; all data via the typed API client.
- **API/BFF (NestJS):** authN/Z, request assembly, rate limiting, synchronous capability-gate checks, enqueuing agent/ingestion jobs, serving domain reads/writes. Exposes REST + a realtime channel.
- **Core domain modules (modular monolith):** `identity`, `resume`, `opportunity`, `application`, `prep`, `analytics`. Each owns its tables and exposes an internal service interface. Module seams are deliberately the future microservice boundaries (PRD §13) — no cross-module DB reads; go through the owning service.
- **Twin/Agent layer (workers):** orchestrator + bounded skill-agents + tool registry + capability-gate + memory service. Runs synchronously (chat) and scheduled (loop). Stateless; pulls jobs from BullMQ.
- **Ingestion/Connectors (workers):** sanctioned-source fetchers → normalize to canonical `Opportunity` → dedup → embed. Untrusted input: sanitized and treated as prompt-injection risk (PRD §15).
- **Data layer:** Postgres (relational + pgvector), S3 (render artifacts/exports), Redis (cache, queue, idempotency, rate limits), event/audit log.
- **Cross-cutting:** OTel tracing across agent steps, immutable audit log, secrets vault, feature flags, per-call LLM cost metering.

## 4. Agent architecture (PRD §18)

- **Orchestrator:** owns the plan for a request or the daily loop; decomposes into bounded skill-agent calls; enforces the autonomy boundary; manages context assembly + per-run cost budget; checkpoints each step to the `BriefingRun`.
- **Skill-agents (bounded, individually eval'd):** `Discoverer`, `Scorer` (produces score + `Explainer` rationale), `Tailor`, `GapAnalyzer`, `Drafter` (cover/outreach), `Interviewer`, `Debriefer`, `BriefingComposer`, plus **CIE agents**: `StateUpdater` (Career State Model), `StrategicReasoner` (decision support), `Planner` (multi-horizon plans), `Researcher` (per research domain), `MetricComposer` (dashboard metrics + explanations). Each: tight typed input/output, own prompt, own eval suite, versioned.
- **Tool registry:** typed tools (`searchSources`, `readMemory`, `writeMemory`, `renderResume`, `scheduleFollowUp`, …), each declaring an **autonomy tier** (Green/Yellow/Red). The capability-gate wraps every tool call.
- **Memory service (§6):** the single path to user memory — retrieval, assembly, summarization. All agents call it; none query memory tables directly.
- **Evaluation harness:** golden datasets + rubric evals per skill-agent; regression-gated in CI; tracks quality + cost + latency per agent version (PRD §18, §22).
- **Observability:** distributed trace per agent step + tool call, tied to the `BriefingRun`/audit id. Non-negotiable — you cannot debug a non-deterministic flow you can't see.

## 4A. Career Intelligence Engine (CIE) services — PRD Amendment A1

The CIE is the central platform; the layers in §3–§4 are its substrate. It adds six long-lived services (all in `apps/workers` + `packages/cie`), each reusing the capability-gate, LLM gateway, `GraphMemoryService`, and audit. All CIE outputs are **advisory/Green**; acting on them stays Yellow/Red.

- **Career State Model service (`packages/cie/state`)** — maintains the versioned, confidence-scored, evidence-linked model of the user (PRD §A1.1). Exposes `getState`, `updateFromEvent(event)`, `explainDimension(dim)`. Every dimension change writes a `MemoryEvent` (why it moved). Recomputed incrementally on new outcomes/decisions/research.
- **Graph memory layer (`packages/memory/graph` → `GraphMemoryService`)** — property graph over Postgres (nodes/edges + node embeddings). Multi-hop traversal + vector retrieval; the single path agents use to reason across entities. Abstracted so it can migrate to a dedicated graph DB later. Extends (does not replace) the four memory tiers.
- **Reasoning / Decision-Support service (`packages/cie/reasoning`)** — answers strategic questions with a **structured contract**: `{ question, alternatives[], evidence[], reasoning, confidence (0–1, calibrated), assumptions[], recommendation, optionalityNote }`. Orchestrates skill-agents + graph queries + research. Never returns a bare verdict. Confidence is logged for later calibration scoring (PRD §A1.7).
- **Strategy Planner service (`packages/cie/planner`)** — generates/maintains 30d/90d/1y/3y/5y plans laddering to goals; regenerates on **material change** and records a diff + rationale. Feeds "today's move" into the briefing. *Material change* is defined (to prevent regeneration thrash): a goal add/remove/reprioritize; a state dimension whose value crosses a band **or** whose confidence moves ≥0.2; a new required-skill edge on ≥2 target roles; or a research finding tagged high-impact for the user. Sub-threshold changes are batched and re-evaluated on the next daily maintenance run, not immediately.
- **Research agents (`apps/workers/research`)** — continuous scheduled monitors (hiring/salary/skills/tech/certs/company/industry) via **sanctioned + licensed sources only** (§7 connector framework, no scraping). Findings → graph evidence nodes → personalized synthesis tied to state + plan. Own cadence, cost-budgeted (cheap scan / frontier synthesis).
- **Dashboard / metrics service (`packages/cie/metrics`)** — computes the intelligence-dashboard metrics (PRD §A1.6) from state + graph + research; every metric drill-downs to evidence and links to the plan action that moves it. Read-only; no new autonomy.

**Cadences:** the orchestrator plans across (a) reactive runs (chat, a decision request), (b) the daily briefing loop (§13/PRD §8), and (c) continuous background runs (research + plan maintenance). All three are queued, checkpointed, idempotent, and cost-metered.

## 5. Capability-gate (autonomy boundary — PRD §7.3, §15)

A middleware every tool call and side-effecting API route passes through.

- **Green (auto):** research, scoring, drafting, gap analysis, briefing generation, memory writes. No external side effects → allowed without approval.
- **Yellow (approve-then-act):** application submission assistance, outreach send, portfolio publish → requires a valid, unexpired **approval token** bound to (user, action, payload-hash).
- **Red (never automated):** authenticating as the user into third-party accounts, accepting/declining offers, ToS-prohibited actions, irreversible legal/financial actions → hard-blocked in code, no token can enable them.

Enforcement is code, not prompt text. An automated security test asserts Yellow/Red actions cannot execute without/with-invalid tokens (from M01).

## 6. Memory model (PRD §7.2)

Four tiers behind `MemoryService`:

- **Profile (structured, authoritative):** relational entities + embeddings; versioned; human-editable; provenance on every fact.
- **Episodic (events):** append-only `MemoryEvent` log of Twin actions + user decisions (with optional reason). Basis for revealed-preference learning.
- **Semantic (derived):** compact regenerable `DerivedInsight` statements; never authoritative; carries source refs + freshness.
- **Working (session):** per-task assembled slice.

**Retrieval:** hybrid — structured queries for facts + vector search for relevant experiences/notes + a summarization pass to fit the context budget. **Never dump all memory**; assemble the minimum relevant slice (cost + quality). Vector access is abstracted so pgvector can be replaced by a dedicated store without touching agents.

## 7. Sanctioned-source connector framework (PRD §3.9)

- An **allow-list registry** of sources, each with: type (ATS-public-API / licensed-aggregator / gov-feed / user-OAuth), fetch adapter, rate-limit policy, and normalization mapping to canonical `Opportunity`.
- Adapters implement a common `SourceConnector` interface. A source not in the registry cannot be called — the HTTP/fetch layer rejects non-allow-listed hosts.
- **No scraping of ToS-protected boards; no automated logged-in actions.** User-connected sources use OAuth, read-scoped where possible, tokens encrypted and revocable.
- Ingested text is **untrusted**: sanitized, and any embedded instructions are neutralized before reaching an LLM (prompt-injection defense).

## 8. Reliability & scaling (PRD §17)

- Stateless API + workers scale horizontally. Postgres single-primary + read replicas early; sharding by `user_id` designed-for, not built-yet.
- Ingestion is queue-buffered so source spikes never hit the DB directly.
- The 8AM loop is **idempotent + checkpointed**: partial source failure → partial briefing + flagged retry, never a blank screen. Idempotency keys in Redis prevent duplicate side effects on retry.
- **Cost control (the real driver is inference):** tiered models (cheap for extract/score/rank, frontier for generation/coaching), aggressive caching + dedup (a posting is parsed/embedded once, not per user), min-slice retrieval, batched overnight runs, per-user budget caps gating the free tier. Cost metered per LLM call.

## 9. Security & privacy (PRD §15)

Managed auth (SSO/passkeys/MFA); per-user row-level scoping; agent layer runs under the user's permission scope; encryption in transit + at rest with field-level encryption for sensitive PII; secrets in vault; least-privilege service creds; GDPR/CCPA alignment with full export + hard delete first-class; no training on user data without opt-in; PII-minimized prompts; output filtering; immutable audit of every Twin action (who/what/when/why/model+version).

## 10. Plugin architecture (PRD §19 — designed-for in v1, exposed in M08)

Skill-agents already conform to a typed capability contract (input/output schema, declared permissions + autonomy tier). Third-party skills are the same contract, run **sandboxed**, under the capability-gate and the user's permission scope. Designing the contract now makes M08 an extension, not a rewrite.

## 11. Environments & CI gates

- Envs: `local` → `preview` (per-PR) → `staging` → `production`.
- CI gates (block merge): typecheck, lint, unit+integration tests, **eval gates** (zero-fabrication + per-skill-agent regression), security test (capability-gate + source allow-list), migration check. See `coding-standards.md`.
