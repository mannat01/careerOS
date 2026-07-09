# CareerOS — Engineering Task Board & Backlog

**Structure:** Epics → Features → Tasks → Subtasks. Ordered for **one-milestone-at-a-time** execution by Claude Fable. Do not pull from a later milestone until the current one meets its Definition of Done (`master-plan.md §4`). Each Epic maps to a milestone; complete Epics in order.

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done · complexity S/M/L/XL · `⛔` = gated by a dependency.

---

## EPIC E01 — Foundations (→ M01) · L
**Goal:** skeleton + invariants enforced from day one.

- **F01.1 Monorepo & CI** — M
  - T Setup Turborepo/pnpm workspaces (`apps/*`, `packages/*` per `project-structure.md`).
    - S scaffolding, shared tsconfig/eslint/tailwind in `packages/config`.
    - S CI: typecheck, lint, test, migrate; preview env per PR.
- **F01.2 Auth & account** — M
  - T Integrate managed auth (SSO/passkeys/MFA); `GET /v1/me`, `PATCH /v1/me/settings`.
  - T Per-user request scoping guard; conservative default `UserSettings`.
  - T Data lifecycle: `POST /v1/me/export`, `DELETE /v1/me` (cascade).
- **F01.3 Core data model** — M
  - T Prisma schema: User, UserSettings, Profile, Experience, Project, Education, SkillClaim, Opportunity, SourceRegistry, AuditLog, ApprovalToken.
- **F01.4 Observability & audit** — M
  - T `packages/observability`: OTel traces, structured logs, audit client.
- **F01.5 Capability-gate** — L
  - T Tier registry (Green/Yellow/Red); token mint/verify; NestJS interceptor + worker wrapper.
  - T ⚑ Security test: Yellow/Red blocked without/with-invalid token.
- **F01.6 Connector framework + first source** — L
  - T `SourceConnector` interface + `SourceRegistry` allow-list (fetch layer rejects non-allow-listed hosts).
  - T One no-auth ATS adapter (Greenhouse/Lever) → normalize → dedup → persist Opportunity; ingestion worker + BullMQ.
  - T ⚑ Security test: non-allow-listed source blocked.
- **F01.7 LLM gateway skeleton** — S · **F01.8 Infra (Terraform)** — M

**E01 DoD:** M01 acceptance criteria pass; security tests green in CI from here on.

---

## EPIC E02 — Identity, Career State Model & Knowledge Graph (→ M02) · XL ⛔E01
**Goal:** bootstrap Profile + memory + the two CIE substrates (graph, state model).

- **F02.1 Resume import & extraction** — L
  - T `POST /v1/profile/import` (PDF/DOCX/LinkedIn) → extraction job → entities + embeddings + provenance.
  - T Profile CRUD; edits authoritative + emit MemoryEvent.
  - T Eval: extraction recall ≥90% on golden set.
- **F02.2 Memory service (4 tiers)** — L
  - T `MemoryService` profile/episodic/semantic/working; hybrid + **min-slice** retrieval (budget-enforced).
- **F02.3 Knowledge graph** — L
  - T `GraphMemoryService` + GraphNode/GraphEdge; upsert from profile; multi-hop + vector; `GET /v1/cie/graph`.
- **F02.4 Career State Model** — L
  - T `packages/cie/state` + CareerStateModel/Dimension; `StateUpdater` agent derives ≥12 dimensions w/ confidence + evidence refs.
  - T Inferred-vs-demonstrated separation; `GET /v1/cie/state`, `/explain`, `/recompute`.
  - T Eval: state-model grounding (zero fabrication); calibration seed.
- **F02.5 Onboarding UI** — M
  - T Import → reflect-back; `CareerStatePanel`, `ProvenanceTag`, `KnowledgeGraphExplorer`, `ConfidenceBadge`.

---

## EPIC E03 — Resume Intelligence (→ M03) · L ⛔E02
- **F03.1 Structured resume model** — M · ResumeModel/Variant; base from profile.
- **F03.2 Tailor agent** — L · select/order/rephrase **real** facts → variant + diff + rationale (Green).
- **F03.3 ATS render + check** — M · PDF/DOCX to S3; `AtsCheckPanel` warnings.
- **F03.4 Match score + explainer** — M · overall+subscores+explanation, reproducible.
- **F03.5 ⚑ Zero-fabrication eval gate (release-blocking)** — M · + tailoring/scoring regression.
- **F03.6 ResumeStudio UI** — M · editor, variant view, `MatchScoreCard`.

---

## EPIC E04 — Discovery, Pipeline & Graph Ingestion (→ M04) · L ⛔E01,E02
- **F04.1 Multi-source connectors (2–3)** — L · adapters + rate policy + normalization; graph upsert on ingest.
- **F04.2 Opportunity APIs** — M · list/detail/filters; sanitized raw_payload (injection defense).
- **F04.3 Discovery-time scoring** — S · reuse Scorer.
- **F04.4 Application pipeline** — M · CRM, status enum, timeline, follow-ups; `applied` only via explicit user action.
- **F04.5 Pipeline UI** — M · `OpportunityCard`, detail, `PipelineBoard`.
- **F04.6 ⚑ Security** — S · allow-list + injection tests.

---

## EPIC E05 — CIE Reasoning Core & Decision Support (→ M05) · XL ⛔E02,E03,E04
**Goal:** assistant → strategist. The platform other milestones plug into.

- **F05.1 Strategic reasoner** — XL
  - T `packages/cie/reasoning` + `StrategicReasoner`; `POST /v1/cie/decide` → full contract (alternatives/evidence/reasoning/confidence/assumptions/recommendation/optionality).
  - T Log confidence for calibration; never a bare verdict.
  - T Eval: decision-support quality + **confidence calibration** + reasoning-grounding.
- **F05.2 Offer comparison** — M · `POST /v1/cie/decide/offers`; weighted by user values/goals; adjustable.
- **F05.3 Twin conversational surface** — L · `WS /rt/twin` streaming; ⌘K `CommandSurface`; min-slice memory + audit; `approval_required` for Yellow.
- **F05.4 Manual briefing** — M · orchestrator composes discovery+scores+gaps+focus → BriefingRun; `BriefingView`.
- **F05.5 UI** — M · `DecisionSupportCard`, `OfferComparator`, `TwinMessage`, `BriefingView`.

---

## EPIC E06 — Career Strategy Planner (→ M06) · L ⛔E05
- **F06.1 Planner agent** — L · `packages/cie/planner`; 5 horizons; objectives+actions linked to nodes/metrics.
- **F06.2 Adaptivity** — M · change-detection hook → regeneration + explained diff (avoid thrash).
- **F06.3 Plan APIs** — S · list/get/regenerate/action-patch.
- **F06.4 Today's move** — S · top action from active 30d plan.
- **F06.5 UI** — M · `StrategyPlanView`, `TodaysMove`.
- **F06.6 Eval** — S · plan quality + goal-alignment + adaptivity.

---

## EPIC E07 — Autonomous Research + Scheduled Automation (→ M07) · XL ⛔E05,E06
- **F07.1 Research agents** — XL · per-domain monitors (sanctioned/licensed only); findings→graph→personalized synthesis; cost-budgeted.
- **F07.2 Scheduler + 8AM loop** — L · cron + quiet hours; full §8 sequence; **idempotent + checkpointed** (partial→partial briefing).
- **F07.3 Approval queue + audit UI** — L · BriefingItem states; approve/edit/skip; token lifecycle; `AuditTimeline`.
- **F07.4 Autonomy tiers live** — M · configurable Green/Yellow/Red enforced E2E; `ConsentControl`.
- **F07.5 Research→plan hook** — S · material findings trigger regeneration.
- **F07.6 ⚑ Security + load** — M · Yellow-in-loop blocked without token; allow-list; batched-loop load test.
- **F07.7 UI** — M · `ResearchFeed`, `RecommendationInbox`.

---

## EPIC E08 — Intelligence Dashboards (→ M08) · L ⛔E06,E07
- **F08.1 Metric composer** — L · `packages/cie/metrics`; 10 metrics w/ value+trend+explanation+evidence+linked action; `DashboardMetric` read model.
- **F08.2 Dashboard APIs** — S · list + drill-down.
- **F08.3 Recompute triggers** — M · input change → recompute + freshness.
- **F08.4 UI** — M · `IntelligenceDashboard` + drill-downs; link to plan action.
- **F08.5 Eval** — S · explanation quality + grounding.

---

## EPIC E09 — Growth Surfaces (→ M09) · L ⛔E03,E04,E05
- **F09.1 Interview prep** — L · `Interviewer` questions+evidence map; `MockSession` feedback; `Debriefer` writeback. Eval: grounding.
- **F09.2 Skill development** — M · `GapAnalyzer` gaps; `LearningItem`; feed planner.
- **F09.3 Cover/outreach drafts** — M · `Drafter` (Green); send is **Yellow** + ToS-gated.
- **F09.4 Portfolio** — M · generate from profile; publish **Yellow**.
- **F09.5 ⚑ Security** — S · send/publish blocked without token.
- **F09.6 UI** — M · `InterviewRoom`, `SkillGapList`, draft composer, `PortfolioRenderer`.

---

## EPIC E10 — Compound & Extend (→ M10) · XL ⛔E07,E08,E09
- **F10.1 Cross-user market intelligence** — L · opt-in, de-identified, aggregated; ⚑ isolation test.
- **F10.2 Confidence calibration** — M · confidence-vs-outcome correlation → feed reasoner.
- **F10.3 Negotiation/offer intelligence** — M · market comp + guidance (advisory; accept = Red).
- **F10.4 Plugin contract + sandbox** — XL · typed capability contract; sandboxed under gate; registry + reference plugin; ⚑ escape test.
- **F10.5 PKM surface** — M · notes/journal → graph → state/plan.
- **F10.6 UI** — M · calibration/admin, negotiation, plugin mgmt, PKM/journal.

---

## Cross-milestone standing backlog (touched in every epic)
- **X.1** Keep eval suites green (per skill-agent regression + zero-fabrication) — gate on merge.
- **X.2** Keep security tests green (capability-gate, source allow-list, injection, isolation).
- **X.3** Per-user LLM cost metering + budget caps; tiered-model routing correctness.
- **X.4** Docs updated with every contract change (schema/api/milestone changelog) in the same PR.
- **X.5** a11y (axe) AA compliance on all new UI.

## Prioritization rationale
Ordered by dependency + value-at-risk. E01–E05 build the standalone wedge **plus** the reasoning core (the CIE's minimum viable strategist). E06–E08 deliver the strategist promise (plans → research → legible trajectory) that differentiates CareerOS from every point tool. E09 deepens; E10 compounds and opens the platform. Security/eval/cost items are standing, not deferrable — they gate every epic.
