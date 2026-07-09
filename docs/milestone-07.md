# Milestone 07 — Autonomous Research + Scheduled Automation

**PRD ref:** §8 + Amendment A1.5 · **Complexity:** XL (≈3–4 eng-weeks) · **Depends on:** M05, M06
**Demo path:** research agents continuously pull market/salary/skill/company signals from sanctioned sources and synthesize them into personalized recommendations tied to the user's plan; the 8AM briefing runs on schedule and presents overnight work in an approval queue; every action is in the audit log; autonomy tiers are live.

---

## Objectives
Make the CIE work continuously and on schedule. Deliver the **autonomous research agents** (A1.5) and the **scheduled 8AM automation loop** (PRD §8) with the full approval queue, audit UI, and live autonomy tiers. The engine now updates the state model, graph, and plans in the background and briefs the user each morning.

## Dependencies
M05 (reasoning core, orchestrator, manual briefing), M06 (planner — research feeds plan adaptivity).

## Deliverables
- **`apps/workers/research` + `Researcher` agents** (per domain: hiring/salary/skills/tech/certs/company/industry) via **sanctioned + licensed sources only** (no scraping); findings → `ResearchFinding` + graph evidence nodes → **personalized synthesis** tied to state/plan (not a generic feed). Cost-budgeted (cheap scan / frontier synthesis); own cadence.
- **Scheduler:** cron per user honoring `briefing_schedule` + quiet hours; enqueues the daily loop (the full §8 ten-step sequence) and periodic research/plan-maintenance.
- **Approval queue + audit UI:** `BriefingRun`/`BriefingItem` states; `approve|edit|skip` endpoints; Yellow items mint/consume `ApprovalToken`; `AuditTimeline`.
- Autonomy tiers **live**: user-configurable Green/Yellow/Red defaults enforced end-to-end.
- APIs: `GET /v1/cie/research`, `/research/feed`, `GET /v1/cie/recommendations`; briefing schedule settings; `GET /v1/audit`.
- Web: `ResearchFeed`, `RecommendationInbox`, scheduled `BriefingView` with `ApprovalControl`, `AuditTimeline`, autonomy settings (`ConsentControl`).

## Acceptance criteria
- Research runs on schedule from sanctioned/licensed sources only (non-allow-listed source blocked); each synthesized recommendation cites its findings and links to the user's state/plan.
- The 8AM loop runs per schedule, honors quiet hours, is **idempotent + checkpointed**: partial source failure yields a partial briefing + flagged retry, never a blank screen.
- Every Yellow item requires a valid `ApprovalToken`; approve/edit/skip persist and are audited; no external action fires without approval.
- New research materially affecting the user triggers plan regeneration (M06 hook) and is explained.
- The full audit log shows who/what/when/why/model for every automated action.

## Testing requirements
- Unit: scheduler cron + quiet hours; idempotency keys; approval-token lifecycle; research cost budgeting.
- Integration: end-to-end 8AM loop (all steps) with an injected source failure → partial briefing; research → synthesis → plan regeneration.
- **Security:** Yellow blocked without token in the loop; source allow-list in research; injection defense on research content.
- **Eval:** research-synthesis relevance/grounding; recommendation personalization (tied to state/plan, cited).
- **Load:** batched overnight loop across many users; ingestion/research queue spikes.
- E2E: scheduled briefing appears → approve/skip items → audit reflects actions.

## Estimated complexity
XL. Risks: reliability + idempotency of a multi-step scheduled loop; research cost control at scale; ensuring "autonomous" never crosses the autonomy boundary.

## Files/modules expected to change
`apps/workers/{scheduler,research,orchestrator}`, `apps/workers/skill-agents` (researcher, briefing-composer), `apps/api/modules/{briefing,cie}` (research, recommendations, approvals), `packages/connectors` (research/licensed sources), `packages/cie/{reasoning,planner}` (research→plan hook), `packages/capability-gate` (live tiers), `packages/db` (ResearchFinding, BriefingRun/Item, ApprovalToken), `apps/web` (`ResearchFeed`, `RecommendationInbox`, `BriefingView`, `AuditTimeline`, `ConsentControl`), `evals/research`.
