# Milestone 10 — Compound & Extend

**PRD ref:** Phase 3 (§6 Intelligence layer, §19) + Amendment A1.7 · **Complexity:** XL (≈3–5 eng-weeks) · **Depends on:** M07, M08, M09
**Demo path:** the CIE's recommendations improve from opt-in, de-identified cross-user outcomes; confidence is calibrated against real results; negotiation/offer intelligence guides a decision; a third-party skill runs sandboxed under the capability-gate; the user's notes/journal (PKM) feed the graph.

---

## Objectives
Turn the flywheel and open the platform. Deliver the compounding-intelligence layer (**cross-user market intelligence + confidence calibration**, PRD §7.4/A1.7), **negotiation/offer intelligence**, the **plugin contract** (§19), and the **PKM** surface — the last pieces that make CareerOS a self-improving, extensible career platform.

## Dependencies
M07 (research + outcomes at volume), M08 (metrics), M09 (growth outcomes). Requires the reasoning/planner cores from M05/M06.

## Deliverables
- **Cross-user market intelligence:** opt-in, de-identified, aggregated outcome signals (privacy rules unchanged) feeding the market model and improving scoring/reasoning; strictly no cross-user data exposure.
- **Confidence calibration:** correlate stored `Recommendation.confidence` against realized outcomes; report + feed back into the reasoner (the A1.7 model-quality guardrail).
- **Negotiation/offer intelligence:** deepen offer comparison with market comp signals + negotiation guidance (advisory; accepting an offer stays Red).
- **Plugin contract (§19):** expose the typed skill-agent capability contract (I/O schema, declared permissions + autonomy tier); third-party skills run **sandboxed** under the capability-gate + user scope; a registry + one reference plugin.
- **PKM surface:** notes/journal/saved-post capture that writes to the graph as evidence; feeds state model + planner.
- Web: calibration view (internal/admin), negotiation guidance in `OfferComparator`, plugin management, PKM/journal.

## Acceptance criteria
- Cross-user intelligence is opt-in and de-identified; a test proves one user's data is never exposed to another; opting out removes contribution.
- Calibration report shows confidence-vs-outcome correlation; the reasoner consumes it (subsequent confidences move toward calibration).
- Negotiation guidance is grounded in market signals + the user's state; accepting/declining an offer is never automated (Red).
- A sandboxed third-party plugin executes only its declared capabilities, under the capability-gate and user scope; it cannot exceed its permissions (security test).
- PKM entries become graph nodes/edges and influence state/plan with provenance.

## Testing requirements
- Unit: de-identification/aggregation; calibration correlation math; plugin permission enforcement; PKM→graph mapping.
- Integration: opt-in/out lifecycle; calibration feedback loop; plugin sandbox execution; PKM → state/plan influence.
- **Security (critical):** cross-user isolation; plugin sandbox cannot escape declared permissions or the capability-gate; Red actions remain uncallable.
- **Eval:** post-calibration recommendation quality; negotiation-guidance grounding.
- E2E: opt in → see improved recommendations; run a plugin; add a journal note → see it affect the plan.

## Estimated complexity
XL. Risks: privacy-preserving aggregation done correctly; a genuinely safe plugin sandbox (this is a security surface — treat any escape as a launch blocker); calibration that actually improves the reasoner.

## Files/modules expected to change
`apps/api/modules/{analytics,cie}`, `apps/workers/skill-agents` (calibration, negotiation), `packages/cie/{reasoning,metrics}`, `packages/agents` (plugin contract + registry + sandbox), `packages/capability-gate` (plugin scoping), `packages/memory/graph` (PKM ingest), `packages/db` (calibration, plugin registry, PKM), `apps/web` (calibration/admin, negotiation, plugin mgmt, PKM/journal), `evals/{calibration,negotiation}`, `infra` (sandbox runtime).
