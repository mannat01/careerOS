# CareerOS — Pre-Flight Readiness Review

**Reviewer pass before handing the doc set to Claude Fable.** Role: architecture/UX/systems reviewer (per the review responsibility — architectural mistakes, security, unnecessary complexity, poor UX, scalability). Verdict at bottom.

**Method:** read the full doc set for internal contradictions, undefined terms Fable would guess at, chicken-and-egg gaps, security holes, and scope ambiguity. Findings below are graded **[Fixed]** (I edited the docs this pass), **[Decision]** (needs your call — I did not guess), or **[Watch]** (fine to start, revisit at the relevant milestone).

---

## Severity 1 — would block or mislead Fable at M01–M03

1. **[Fixed] Eval gates with no data (chicken-and-egg).** M02/M03 gate merges on eval suites, but greenfield has no golden datasets, so the gates would be empty/meaningless. → Added a "golden-dataset bootstrap" rule to `coding-standards.md §4`: each agent's *first* deliverable is a hand-authored 10–30 case golden set committed before the agent logic. Named which milestone authors which set.

2. **[Fixed] "Material change" was undefined** but M06 depends on it to avoid regeneration thrash — Fable would have invented a threshold. → Defined concretely in `architecture.md §4A` (goal change; state value crosses a band or confidence moves ≥0.2; new required-skill on ≥2 target roles; high-impact research finding; else batched to daily maintenance).

3. **[Fixed] Twin vs CIE terminology drift.** After Amendment A1, "Twin" appears as both the intelligence layer (old) and the conversational surface (new). → Added a Glossary to `master-plan.md §1A` fixing the meaning: CIE = intelligence platform, Twin = its conversational surface.

## Severity 2 — would cause avoidable rework mid-build

4. **[Fixed] Missing concrete pagination/rate-limit defaults.** `api-spec.md` described the mechanism but not values. → Added defaults (limit 25/max 100; 120 reads/min, 20 mutations/min; per-source + per-user LLM budget; `Retry-After`).

5. **[Fixed] MatchScore cardinality looked contradictory** (overview says 1:1 (profile,opportunity); table says unique on model_version). → Clarified in `database-schema.md`: 1:many over versions, latest read for display, history retained.

6. **[Watch] Cost model for the 8AM loop.** The §8 loop tailors resumes + drafts cover letters for "top opportunities" every morning for every user — the PRD itself flags this as a P&L risk. Mitigations exist (tiered models, caching, batching, budget caps in `task-board.md X.3`). *Action for M07:* set the default "top N" low (suggest 3) and make tailoring/draft steps opt-in per user, not automatic for all discovered roles. Not a doc bug — a default to choose at M07.

## Severity 3 — fine to start, revisit at the milestone

7. **[Watch] Graph store choice.** pgvector + property tables over Postgres is right for M02 (one store, simpler ops). Re-evaluate a dedicated graph DB only if multi-hop traversal latency degrades at scale — `GraphMemoryService` already abstracts this, so it's a swap, not a rewrite. No action now.

8. **[Watch] Managed-auth vendor not pinned** (Clerk *or* WorkOS). Fine to defer to M01 F01.2; both satisfy SSO/passkeys/MFA. Pick when scaffolding auth.

9. **[Watch] Realtime transport** (WS vs SSE) left as "WS/SSE." Decide at M05 F05.3; WS is the safer default for bidirectional tool-call streaming. No action now.

10. **[Watch] Plugin sandbox runtime** (M10) is the single biggest security surface and is correctly deferred. Flag: treat sandbox-escape as a launch blocker (already noted in milestone-10). Revisit design at M10 start.

## Decisions — RESOLVED (see `docs/decisions.md`)

All three open decisions are now Accepted ADRs and no longer block anything:
- **[Resolved] ADR-001 LLM vendor strategy** — multi-vendor-capable gateway, single-vendor (Anthropic) launch with cheap/frontier tiers; defer routing.
- **[Resolved] ADR-002 Source mix** — M01 Greenhouse; M04 add Lever + USAJobs (free/legal launch set); licensed aggregator post-wedge.
- **[Resolved] ADR-003 Free vs. paid gating** — freemium, $29/mo paid; free = wedge + 30/90d planner + read dashboards + capped LLM; paid = automation, research, all horizons, full sources. Entitlement + budget checks become DoD for M06–M09.

## Cross-doc consistency checks (passed)
- All 10 milestones referenced consistently across `master-plan.md`, `task-board.md`, and `milestone-*.md` (10 files present; numbering fixed).
- Module/package names consistent between `project-structure.md`, `architecture.md`, and each milestone's "files to change."
- Invariants (autonomy-in-code, human-in-loop, sanctioned-sources, zero-fabrication) restated and testable in every milestone that touches them.
- Every CIE artifact carries confidence + provenance + model_version across PRD, schema, and API.

## Verdict
**Ready for Fable to begin M01.** The Severity-1 gaps that would have caused Fable to guess are fixed in-place this pass. The open **[Decision]** items do not block M01 (Foundations) — they land at M04/M05/M07 — but should be resolved before those milestones. Recommend proceeding to: Fable operating guide → M01 work order → repo scaffold.
