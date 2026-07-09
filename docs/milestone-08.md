# Milestone 08 — Intelligence Dashboards

**PRD ref:** Amendment A1.6 + §12 · **Complexity:** L (≈2–3 eng-weeks) · **Depends on:** M06, M07
**Demo path:** the user opens a dashboard showing career momentum, interview readiness, skill momentum, market positioning, salary trajectory, opportunity quality, networking strength, recruiter engagement, portfolio completeness, and current strategic recommendations — each with a trend, a plain-language "why it matters," a drill-down to evidence, and a link to the plan action that moves it.

---

## Objectives
Make career trajectory **legible**. Compute the intelligence-dashboard metrics from the state model + graph + research, each explained and actionable. Dashboards are a read surface over the CIE — no new autonomy — that closes the loop between "here's where you stand" and "here's the action that improves it."

## Dependencies
M06 (plans/actions to link metrics to), M07 (research signals + adherence data from automation).

## Deliverables
- **`packages/cie/metrics` + `MetricComposer` agent:** compute each A1.6 metric with value, trend, explanation, evidence refs, and a linked plan action; persist `DashboardMetric` (read model), recomputed on relevant change.
- APIs: `GET /v1/cie/dashboards`, `GET /v1/cie/dashboards/:metric` (drill-down to evidence).
- Web: `IntelligenceDashboard` (grid of explained metrics with `ExplainPopover` + trend), per-metric drill-down; each metric links to `TodaysMove`/plan action.

## Acceptance criteria
- All ten metrics render with value + trend + a "why it matters" explanation; **no bare numbers**.
- Each metric drills down to the evidence (state dimensions, graph nodes, research findings, application outcomes) it was computed from.
- Each metric links to the plan action that would move it; clicking navigates to that action.
- Metrics recompute when their inputs change (e.g., a completed interview updates interview readiness) and expose `computed_at` freshness.

## Testing requirements
- Unit: each metric's computation from inputs; trend calc; freshness.
- Integration: input change → metric recompute → evidence drill-down resolves.
- **Eval:** metric-explanation quality (accurate, plain-language, actionable); metric-grounding (evidence refs resolve and support the value).
- E2E: open dashboard → drill into a metric → follow the linked plan action.

## Estimated complexity
L. Risk: metric definitions that are meaningful and stable (not noisy); explanations that are honest about uncertainty.

## Files/modules expected to change
`apps/api/modules/cie` (dashboards), `apps/workers/skill-agents` (metric-composer), `packages/cie/metrics`, `packages/db` (DashboardMetric), `apps/web` (`IntelligenceDashboard`, drill-downs), `packages/ui` (`IntelligenceDashboard`, metric cards), `evals/metrics`.
