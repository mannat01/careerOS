# Milestone 02 — Identity, Career State Model & Knowledge Graph

**PRD ref:** Phase 1 + Amendment A1.1–A1.2 · **Complexity:** XL (≈3–4 eng-weeks) · **Depends on:** M01
**Demo path:** user uploads a resume → within minutes sees (a) a structured, provenance-tagged profile, (b) a **Career State Model** reflecting goals/strengths/skills with confidence, and (c) an explorable **career graph** connecting their experiences, skills, and companies. All editable.

---

## Objectives
Bootstrap the CIE's foundation: turn an upload into structured Profile entities (the original M02 goal), stand up the four-tier memory behind `MemoryService`, **and** — per Amendment A1 — establish the two CIE substrates every later milestone reasons over: the **Career Knowledge Graph** (`GraphMemoryService`) and the **Career State Model**. This is the "it already gets me" onboarding beat, now backed by a real user model, not just a parsed resume.

## Dependencies
M01 (data core, workers, llm-gateway, capability-gate, audit).

## Deliverables
- `POST /v1/profile/import` (PDF/DOCX/LinkedIn export) → extraction job → `Experience/Project/Education/SkillClaim` with `provenance` + embeddings.
- Profile CRUD; user edits persist authoritative + emit `MemoryEvent`.
- `packages/memory` `MemoryService` (profile/episodic/semantic/working) with hybrid, **min-slice** retrieval.
- **`packages/memory/graph` `GraphMemoryService`:** `GraphNode`/`GraphEdge` tables; upsert of nodes/edges from the imported profile (experiences→companies→skills→projects); multi-hop traversal + node vector retrieval; graph read API `GET /v1/cie/graph`.
- **`packages/cie/state` Career State Model:** `CareerStateModel` + `CareerStateDimension` tables; `StateUpdater` agent that derives initial dimensions (goals/strengths/weaknesses/demonstrated+inferred skills/etc.) each with confidence + `evidence_refs` to graph nodes; `GET /v1/cie/state`, `/state/:dimension/explain`, `POST /state/recompute`.
- Web: onboarding/import → reflect-back screen with `ProvenanceTag`, `CareerStatePanel` (dimensions + `ConfidenceBadge`), and a basic `KnowledgeGraphExplorer`.

## Acceptance criteria
- Import extracts ≥90% of experiences/skills into structured entities, each with provenance; user can correct any field; corrections persist + emit `MemoryEvent`.
- Importing a profile creates a connected graph: every experience links to a company node and its skill nodes; querying `GET /v1/cie/graph?node=<skill>&depth=2` returns the multi-hop neighborhood.
- The Career State Model populates ≥12 of the A1.1 dimensions, each with a confidence (0–1), provenance, and evidence refs resolvable to graph nodes; **inferred skills are flagged distinct from demonstrated** and are never written to any resume artifact.
- Editing a profile fact updates the affected state dimension(s) and records *why it moved* as a `MemoryEvent`.
- `MemoryService.retrieve(task)` returns a bounded slice (respects token budget); verified it never returns full memory.

## Testing requirements
- Unit: extraction mappers; provenance assignment; graph upsert idempotency; edge-type validity; min-slice budget; state-dimension confidence assignment.
- Integration: import → entities + graph + state model in one flow; edit → state update + `MemoryEvent`.
- **Eval:** extraction recall ≥90% on golden resumes; state-model eval (dimensions grounded in real evidence, **zero fabricated facts**); inferred-vs-demonstrated separation eval.
- E2E: upload → reflect-back → graph explore → edit persists.

## Estimated complexity
XL. Risks: graph modeling that stays queryable at scale; state-model dimension derivation that is well-calibrated and fully evidence-linked (no ungrounded claims); keeping min-slice retrieval genuinely bounded once a graph exists.

## Files/modules expected to change
`apps/api/modules/identity` (import, profile CRUD), `apps/api/modules/cie` (state, graph read), `apps/workers/skill-agents` (extractor, state-updater), `apps/workers/ingestion` (graph upsert), `packages/memory` (+`graph`), `packages/cie/state`, `packages/db` (graph, state tables), `packages/contracts`, `apps/web` (onboarding, reflect-back, `CareerStatePanel`, `KnowledgeGraphExplorer`), `packages/ui` (`ProvenanceTag`, `ConfidenceBadge`, `CareerStatePanel`, `KnowledgeGraphExplorer`), `evals/{extraction,state-model}`.
