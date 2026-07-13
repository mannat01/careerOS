# @careeros/cie-state

Career State Model service (dynamic, confidence-scored user model — PRD §A1.1).

`CareerStateModel` + `CareerStateDimension` (per `database-schema.md §cie`) plus the
`StateUpdater` skill-agent (folder shape `agent.ts` / `prompt.ts` / `io.ts` /
`agent.eval.ts`). The agent derives ≥12 A1.1 dimensions from a user's profile facts
+ Career Knowledge Graph — reached ONLY through `MemoryService` /
`GraphMemoryService`, never `@careeros/db` (enforced by the `agentBoundary` lint
overlay). Each dimension carries `value`, `confidence` (0–1), `provenance`, and
`evidence_refs` resolvable to graph nodes / profile facts.

## Deterministic guardrails (io.ts)

The LLM proposal is untrusted; the invariants are enforced in code, not prose:

- **demonstrated vs inferred** — a skill only enters `demonstrated_skills` when a
  profile fact demonstrates it; adjacency inferences (e.g. "distributed systems"
  from Kubernetes) are RELOCATED to `inferred_skills` with capped confidence.
- **listed-only stays inferred** — a `claimed` skill (Tableau) can never be
  demonstrated; it is downgraded to `inferred_skills`.
- **no-signal dimensions stay empty** — compensation / geography are dropped
  unless a real signal grounds them (a state license ≠ a location preference).
- **evidence-or-drop** — every asserted value must cite a resolvable
  `evidence_ref`; unresolvable citations are dropped.
- **thin evidence caps confidence ≤ 0.4**.

See `docs/project-structure.md` for import boundaries and `docs/architecture.md`
for role.
