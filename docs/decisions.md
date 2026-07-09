# CareerOS — Decision Log (ADRs)

Records the decisions that were open in `readiness-review.md`. Each is now **Accepted** and binding on the doc set and Fable. Amend here (not in scattered docs) if a decision changes.

---

## ADR-001 — LLM vendor strategy: multi-vendor-capable gateway, single-vendor launch
**Status:** Accepted · **Affects:** `packages/llm-gateway`, `architecture.md §17`, M01/M05.

**Decision.** Build `llm-gateway` with a provider-abstraction and a `tier` parameter from day one, but **launch on a single vendor (Anthropic)** with two tiers: a **cheap/fast** model for extraction, scoring, ranking, classification, research scanning; a **frontier** model for tailoring, strategic reasoning, planning, synthesis, coaching. Do **not** build active cross-vendor routing yet.

**Rationale.** The real cost driver is inference (PRD §17); the abstraction is what protects us, not a second live vendor. Premature multi-vendor routing adds failure modes and eval surface with no current payoff. Because the interface is vendor-neutral, adding a second provider later is a config + adapter change, not a rewrite.

**Consequences.** One set of provider creds to manage at launch. Cost controls (caching, dedup, min-slice, per-user budgets) do the heavy lifting. Revisit adding a second vendor when (a) cost data shows a cheaper model would materially help a high-volume step, or (b) we need vendor redundancy for reliability SLAs.

**Trade-off acknowledged.** Single-vendor = a soft dependency/availability risk. Mitigated by the abstraction (fast failover path exists) and by keeping the frontier/cheap split model-agnostic.

---

## ADR-002 — Sanctioned source mix: free/legal feeds first, licensed aggregator later
**Status:** Accepted · **Affects:** `packages/connectors`, M01 (F01.6), M04 (F04.1), PRD §3.9.

**Decision.**
- **M01:** integrate **Greenhouse public API** (no-auth, simplest) as the single end-to-end source.
- **M04:** add **Lever public API** + **USAJobs** (government open feed). Launch source set = Greenhouse + Lever + USAJobs — all free, legal, no contract/scraping.
- **Post-wedge (M07+):** add one **licensed commercial aggregator** (e.g., Adzuna) once budget and volume justify a contract, to broaden coverage.

**Rationale.** Fastest legal path to real coverage with zero contract friction and zero ToS/scraping risk (the §3.9 invariant). Greenhouse + Lever cover a large slice of tech/startup ATS postings; USAJobs adds public-sector breadth. A paid aggregator is additive, not foundational, so it doesn't gate the wedge.

**Consequences.** Early coverage skews toward companies using Greenhouse/Lever + federal roles; acceptable for the wedge's quality-over-coverage stance (PRD §23 cold-start mitigation). The connector allow-list starts with exactly these keys; anything else is blocked at the fetch layer.

---

## ADR-003 — Free vs. paid gating and price
**Status:** Accepted · **Affects:** `packages/capability-gate` budgets, `apps/api` entitlements, M06/M07/M08, PRD §12.

**Decision.** Freemium, single paid tier at **$29/mo** (within PRD's $20–35 band; annual discount later).

**Free tier (the standalone wedge + a taste of strategy):**
- Career State Model + Knowledge Graph + profile/memory.
- Resume tailoring: **5 tailored variants / month**.
- Discovery: Greenhouse + Lever (not the full set); manual briefing only.
- Strategy Planner: **30-day + 90-day** horizons only.
- Intelligence dashboards: **read-only**, core metrics.
- Twin chat + decision support: **limited daily budget** (per-user LLM cap).

**Paid tier ($29/mo):**
- Scheduled 8AM automation + autonomous research agents.
- Unlimited tailoring; full source coverage (incl. USAJobs + any licensed aggregator).
- Strategy Planner: **all horizons (1y/3y/5y)**.
- Interview prep, cover/outreach drafting, full dashboards, negotiation intelligence.
- Higher/again-metered LLM budget.

**Budget enforcement.** Per-user daily LLM budget caps gate the free tier (PRD §17); exceeding → `rate_limited` with an upgrade path. Entitlements are checked server-side (never client-trusted). The autonomy boundary is unchanged and independent of tier — paid does **not** buy the ability to auto-submit; Yellow/Red still require approval.

**Rationale.** Free must deliver genuine standalone value (the wedge) and prove "it gets me," while the compounding, always-on strategist capabilities (automation, research, long-horizon planning) are the paid wedge — they're the ongoing *work* we monetize (PRD §12), not one-time documents.

**Consequences.** Milestones that ship gated capabilities (M06 planner horizons, M07 automation/research, M08 dashboards, M09 prep/drafts) must implement an entitlement check + budget metering as part of their Definition of Done. Validate price/gates with real conversion data post-launch; this ADR is the starting point, not a permanent commitment.
