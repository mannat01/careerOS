# Milestone 06 — Career Strategy Planner

**PRD ref:** Amendment A1.4 · **Complexity:** L (≈2–3 eng-weeks) · **Depends on:** M05
**Demo path:** the user sees adaptive 30-day / 90-day / 1-year / 3-year / 5-year plans laddering to their goals; each action is justified and linked to what it moves; changing a goal or profile fact visibly re-generates the affected plans with an explained diff; the home screen shows "today's move."

---

## Objectives
Turn reasoning into forward plans. Build the **Career Strategy Planner** that generates and maintains multi-horizon plans, keeps them adaptive (auto-regenerate on material change), and surfaces the single highest-value action today. This is the "optimize long-term outcomes" promise made concrete.

## Dependencies
M05 (reasoning core, state model, graph, decision support).

## Deliverables
- **`packages/cie/planner` + `Planner` agent:** generate `StrategyPlan` per horizon (objectives + rationale + expected impact + confidence; sequenced `PlanAction`s each linked to a skill/project/cert/role/person node and the metric it moves).
- Adaptivity: a change-detection hook (state/goal/graph/research delta) enqueues regeneration; new plan supersedes prior with a stored `diff` + rationale.
- APIs: `GET|POST /v1/cie/plans`, `GET /v1/cie/plans/:horizon`, `POST .../regenerate`, `PATCH /v1/cie/plans/actions/:id`.
- "Today's move": derive the top action from the active 30-day plan; expose for the briefing/home.
- Web: `StrategyPlanView` (horizon tabs, action states, regenerated-diff banner), `TodaysMove`.

## Acceptance criteria
- Generating plans produces all five horizons, each laddering to a stated goal, with shorter horizons action-level and longer horizons directional/optionality-oriented.
- Every action carries rationale, expected impact, confidence, and a link to the node/metric it advances.
- Materially changing a goal or key profile fact auto-regenerates the affected plan(s); the change is explained in a diff ("moved X earlier because …").
- Updating an action's status persists and is available to adherence metrics (M08).
- "Today's move" returns a single, justified action drawn from the active 30-day plan.

## Testing requirements
- Unit: plan assembly; horizon laddering; change-detection delta logic; diff computation.
- Integration: generate → persist; goal change → regeneration + diff; action status update.
- **Eval:** plan quality + goal-alignment eval; adaptivity eval (regeneration is warranted and correctly explained, not churn).
- E2E: view plans → change a goal → see explained regeneration → see today's move.

## Estimated complexity
L. Risk: adaptivity that regenerates when *warranted* (avoid thrashing on trivial changes); plans grounded in the graph rather than generic advice.

## Files/modules expected to change
`apps/api/modules/cie` (plans), `apps/workers/skill-agents` (planner), `apps/workers/scheduler` (plan-maintenance trigger), `packages/cie/planner`, `packages/cie/state` (change hooks), `packages/db` (StrategyPlan, PlanAction), `apps/web` (`StrategyPlanView`, `TodaysMove`), `packages/ui`, `evals/planner`.
