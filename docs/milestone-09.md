# Milestone 09 — Growth Surfaces

**PRD ref:** Phase 2 (§6 Growth layer) · **Complexity:** L (≈2.5–3 eng-weeks) · **Depends on:** M03, M04, M05
**Demo path:** for a tracked opportunity the user gets role-specific interview questions with evidence-backed answer scaffolds and a mock session with feedback; sees a prioritized skill-gap list with learning recommendations; generates cover-letter/outreach drafts (send is Yellow); and publishes a portfolio generated from their profile.

---

## Objectives
Deliver the growth layer that turns strategy into preparation and presence: **interview preparation**, **skill development**, **cover/outreach drafting**, and the **public portfolio**. All plug into the CIE — prep pulls evidence from the graph/state; skill gaps feed the planner; portfolio quality feeds the dashboard.

## Dependencies
M03 (materials), M04 (opportunities/pipeline), M05 (reasoning/memory). Uses M06 planner + M08 metrics if present, but degrades gracefully without them.

## Deliverables
- **Interview prep:** `Interviewer` agent → role-specific likely questions + evidence map (question→profile/graph evidence); `MockSession` with answer feedback + scores; `Debriefer` writes outcomes back to memory/graph.
- **Skill development:** `GapAnalyzer` → per-opportunity + aggregate `SkillGap`; `LearningItem` recommendations + progress; gaps surface as planner inputs.
- **Cover/outreach drafts:** `Drafter` agent → drafts (Green); `POST /v1/drafts/:id/send` is **Yellow** (approval token; only via user-connected channel where ToS permits, else `capability_denied` with manual-send guidance).
- **Portfolio:** `PortfolioRenderer` generates a public portfolio from profile; publish is **Yellow**.
- Web: `InterviewRoom`, `SkillGapList`, draft composer with `ApprovalControl`, `PortfolioRenderer`.

## Acceptance criteria
- Interview prep generates role-specific questions with an evidence map resolvable to real profile/graph facts (no fabricated evidence); mock sessions produce structured feedback + scores; debrief updates memory.
- Skill-gap analysis produces per-opportunity and aggregate gaps with severity; learning items track progress and appear as planner inputs.
- Drafts generate as Green; **sending** requires a valid approval token and respects destination ToS (blocked with guidance where automated send isn't permitted).
- Portfolio publish is Yellow and audited; unpublished stays private.

## Testing requirements
- Unit: question generation grounding; gap severity; draft assembly; portfolio render.
- Integration: prep → mock → debrief → memory update; gap → learning item → planner input.
- **Eval:** interview-question relevance + evidence-grounding (zero fabrication); draft quality/tone.
- **Security:** draft-send + portfolio-publish blocked without approval token; ToS-gated send enforced.
- E2E: opportunity → prep → mock feedback; generate + (attempt to) send a draft.

## Estimated complexity
L. Risk: evidence-grounded interview answers (not generic); correct ToS gating on send channels.

## Files/modules expected to change
`apps/api/modules/prep` (interview, skills), `apps/api/modules/resume` (drafts), `apps/api/modules/identity` (portfolio), `apps/workers/skill-agents` (interviewer, debriefer, gap-analyzer, drafter), `packages/cie/planner` (gap intake), `packages/capability-gate` (send/publish tiers), `packages/db` (InterviewPrep, MockSession, SkillGap, LearningItem), `apps/web` (`InterviewRoom`, `SkillGapList`, draft composer, `PortfolioRenderer`), `packages/ui`, `evals/{interview,drafting}`.
