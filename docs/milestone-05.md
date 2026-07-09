# Milestone 05 — CIE Reasoning Core & Decision Support

**PRD ref:** §7 + Amendment A1.3 · **Complexity:** XL (≈3–4 eng-weeks) · **Depends on:** M02, M03, M04
**Demo path:** the user asks "should I apply for this role, or wait?" and the CIE returns alternatives, the evidence it used (from graph + state + score), transparent reasoning, a calibrated confidence, its assumptions, and a recommendation — and can objectively compare two offers. The Twin conversational surface (⌘K) answers using memory. A manual briefing can be triggered.

---

## Objectives
Stand up the **strategic reasoning core** — the shift from assistant to strategist. Deliver the decision-support contract (`evidence → reasoning → confidence → recommendation`, optionality-aware), the conversational Twin surface over the CIE, and a manual-trigger briefing that composes existing capabilities. This is where the CIE becomes the platform other milestones plug into.

## Dependencies
M02 (state model + graph), M03 (resume/match), M04 (opportunities/pipeline).

## Deliverables
- **`packages/cie/reasoning` + `StrategicReasoner` agent:** implements `POST /v1/cie/decide` returning the structured contract; orchestrates graph queries + state model + match scores + (later) research. Confidence is logged for calibration (M10).
- `POST /v1/cie/decide/offers`: objective multi-factor offer comparison weighted by the user's values/goals from the state model.
- **Twin conversational surface:** `WS /rt/twin` streaming; ⌘K `CommandSurface`; every turn assembles min-slice memory (incl. graph), logs to audit, and can invoke reasoning. `approval_required` events for any Yellow action surfaced from chat.
- **Manual briefing:** `POST /v1/briefings/run {trigger:"manual"}` → orchestrator composes discovery + scores + gaps + a strategic "what to focus on" into a `BriefingRun`; `BriefingView`. (Scheduling is M07.)
- Web: `DecisionSupportCard`, `OfferComparator`, `CommandSurface`, `TwinMessage`, `BriefingView`.

## Acceptance criteria
- `POST /v1/cie/decide` returns all contract fields (alternatives, evidence refs resolvable to graph/state, reasoning, confidence 0–1, assumptions, recommendation, optionality note); **never a bare verdict**; the run is audited with the model version.
- Offer comparison produces a weighted, explained ranking whose weights reflect the user's stated values/goals and are user-adjustable.
- The Twin answers a memory-grounded question by streaming, cites the evidence it used, and assembles only a bounded memory slice.
- Any action proposed in chat that is Yellow (e.g., "send this outreach") triggers `approval_required` and cannot execute without a token.
- Manual briefing completes idempotently and every step appears in the audit log with cost + trace id.

## Testing requirements
- Unit: reasoning contract assembly; evidence-ref resolution; offer-weighting math; min-slice assembly with graph.
- Integration: decide → contract; offers → ranking; chat turn → memory retrieval + audit; manual briefing composition.
- **Eval:** decision-support quality + **confidence calibration** eval (stated confidence tracks correctness on a labeled set); reasoning-grounding eval (every claim traces to real evidence — no fabrication).
- **Security:** Yellow action from chat blocked without token.
- E2E: ask a strategic question → receive full contract; compare two offers.

## Estimated complexity
XL. Highest-value, highest-risk milestone: getting reasoning that is genuinely grounded in the graph/state (not plausible-sounding but unsupported) and confidence that is calibrated, not decorative.

## Files/modules expected to change
`apps/api/modules/cie` (decide, offers), `apps/api/modules/briefing` (manual run), `apps/workers/orchestrator`, `apps/workers/skill-agents` (strategic-reasoner, briefing-composer), `packages/cie/reasoning`, `packages/memory/graph` (traversal for reasoning), `packages/contracts` (reasoning contract), `apps/web` (`CommandSurface`, `TwinMessage`, `DecisionSupportCard`, `OfferComparator`, `BriefingView`), `packages/ui`, `evals/{decision-support,calibration}`.
