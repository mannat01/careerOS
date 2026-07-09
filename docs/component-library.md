# CareerOS — Component Library

**Derived from:** PRD §16, `design-system.md`. Built on shadcn/ui + Radix in `packages/ui`. Every component: typed props, all states, keyboard + a11y, token-driven styling, a story/example, and no hard-coded colors. States to cover for data components: `default · loading · empty · error · success/optimistic`.

---

## 1. Primitives (from shadcn/Radix, themed)

Button, IconButton, Input, Textarea, Select, Combobox, Checkbox, Radio, Switch, Slider, Tooltip, Popover, Dialog, Sheet/Drawer, Tabs, Accordion, Toast, Badge, Avatar, Card, Table, Skeleton, Progress, ScrollArea, DropdownMenu, Separator. These are wrapped once with tokens; app code uses the wrappers, never raw shadcn.

## 2. Product components (CareerOS-specific)

| Component | Purpose | Key props | Notable states |
|---|---|---|---|
| `CommandSurface` (⌘K) | Global Twin/command palette | `context`, `onAction` | open/closed, streaming, results, empty |
| `TwinMessage` | Streamed Twin turn w/ tool events | `events[]`, `streaming` | token-stream, tool_call, approval_required, error |
| `ExplainPopover` | The universal "why" affordance | `subject`, `rationale`, `sources[]` | loading, loaded |
| `MatchScoreCard` | Overall + subscore breakdown | `overall`, `subscores`, `explanation` | always shows explanation; never bare number |
| `OpportunityCard` | Discovered job w/ score + source | `opportunity`, `match`, `sourceBadge` | new, viewed, saved, dismissed |
| `PipelineBoard` | Kanban of applications | `columns`, `onMove` | drag, optimistic move, empty column |
| `ResumeStudio` | Structured resume editor + preview | `resumeModel`, `variant?` | editing, tailoring (async), render-ready |
| `AtsCheckPanel` | ATS-parse warnings on a variant | `atsCheck` | pass, warnings, fail |
| `BriefingView` | The daily one-screen briefing | `run`, `items[]` | queued, running(partial), complete, failed |
| `ApprovalControl` | Approve/edit/skip a Yellow item | `item`, `tier`, `onApprove/onEdit/onSkip` | proposed, approving, approved, skipped, denied |
| `AutonomyTierBadge` | Green/Yellow/Red indicator | `tier` | uses `tier/*` tokens consistently |
| `AuditTimeline` | Immutable log of Twin actions | `entries[]` | grouped-by-day, empty |
| `ProvenanceTag` | Shows source of a profile fact | `provenance` | imported/user/inferred_confirmed |
| `InterviewRoom` | Mock interview run | `session` | idle, question, recording, feedback |
| `SkillGapList` | Gaps + learning items | `gaps[]`, `learning[]` | empty, in-progress |
| `SourceConnectCard` | Connect/revoke a source | `source`, `status` | connectable, connected, revoked, not-allowed |
| `ConsentControl` | Data-use / autonomy settings | `settings`, `onChange` | default conservative |
| `PortfolioRenderer` | Public portfolio (M09) | `profile`, `theme` | draft, published |
| `ConfidenceBadge` | Calibrated confidence on any CIE output | `confidence` (0–1) | low/med/high bands, tooltip w/ meaning |
| `CareerStatePanel` | Career State Model dimensions | `dimensions[]` | per-dimension value + `ConfidenceBadge` + `ProvenanceTag` + explain |
| `DecisionSupportCard` | The evidence→reasoning→confidence contract | `alternatives`, `evidence`, `reasoning`, `confidence`, `recommendation`, `optionalityNote` | loading, ready; never renders bare verdict |
| `OfferComparator` | Objective multi-factor offer comparison | `offers[]`, `weights` | weighting editable, explained |
| `StrategyPlanView` | Multi-horizon plan (30d/90d/1y/3y/5y) | `plan`, `horizon`, `diff` | horizon tabs, action states, regenerated-diff banner |
| `TodaysMove` | The single highest-value action today | `action` | from active 30d plan; links to metric it moves |
| `IntelligenceDashboard` | Grid of explained metrics | `metrics[]` | each: value+trend+`ExplainPopover`+linked action; drill-down |
| `KnowledgeGraphExplorer` | Interactive career graph | `subgraph`, `focusNode` | node/edge inspect, multi-hop expand |
| `ResearchFeed` | Personalized synthesized findings | `findings[]` | cited, tied to state/plan; empty |
| `RecommendationInbox` | Open strategic recommendations | `recommendations[]` | accept/reject/defer → calibration |

## 3. Cross-cutting behaviors

- **Approval-first surfaces:** any component that can trigger a Yellow action renders `ApprovalControl` + `AutonomyTierBadge`; it cannot fire the action without an approval token from the API (`capability_denied` → show consent path, never silently fail).
- **Explainability:** `MatchScoreCard`, `TwinMessage`, and any suggestion embed `ExplainPopover`. No score/recommendation ships without it.
- **Provenance everywhere in profile:** profile fact rows show `ProvenanceTag`; inferred facts are visually distinct and one-click editable.
- **Streaming & optimistic:** Twin and briefing surfaces use live regions; pipeline and edits are optimistic with rollback on error.

## 4. Definition of done (per component)

Typed props (zod-inferred where shared); all applicable states implemented; keyboard + screen-reader verified; axe-clean; token-only styling; example/story; used via `packages/ui` (no duplication in apps).
