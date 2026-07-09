# CareerOS — Design System

**Derived from:** PRD §16 (Apple/Linear/Spotify/Arc/Notion/Vercel; simplicity, elegance, speed, discoverability, emotional engagement). Tokens live in `packages/ui/tokens` + `packages/config/tailwind`. WCAG 2.1 AA is a hard requirement, not a polish pass.

---

## 1. Principles → implementation rules

- **Calm, prioritized home over dashboard-of-widgets.** Layouts default to a single narrative column with progressive disclosure. Density is opt-in.
- **Ambient Twin, not a corner chatbot.** The command surface (⌘K) is global; Twin voice appears inline (suggestion chips, expandable rationale), not siloed in a chat tab.
- **Show the reasoning.** Every score/suggestion has an `Explain` affordance. Never render a number without a path to *why*.
- **Speed is a feature.** Optimistic UI, skeleton states, streamed responses, route prefetch. Perceived latency budget: interaction feedback <100ms, meaningful content <1s.
- **Momentum as feeling.** Gentle progress/streak cues; "worked overnight" summary. Never dark-pattern gamification.

## 2. Design tokens

**Color** — semantic tokens, dual light/dark. Never hard-code hex in components; use tokens.
- `bg/base`, `bg/subtle`, `bg/elevated`, `border/subtle`, `border/strong`
- `text/primary`, `text/secondary`, `text/muted`, `text/inverse`
- `brand/base`, `brand/emphasis`, `brand/subtle`
- Status: `success`, `warning`, `danger`, `info` (each `/base` + `/subtle`)
- Autonomy semantics (product-specific, load-bearing): `tier/green`, `tier/yellow`, `tier/red` — used consistently wherever the autonomy boundary surfaces so users learn the color language.
- Confidence semantics (CIE, PRD A1.3): `confidence/low`, `confidence/med`, `confidence/high` — every CIE recommendation/metric shows calibrated confidence in this language; never a bare number without its confidence band and an explain path.

**Typography** — one sans (e.g., Inter) + a mono for data/code. Scale: `display, h1, h2, h3, body-lg, body, body-sm, caption`. Line-height generous for reading; tabular-nums for metrics.

**Spacing** — 4px base grid: `space-1..12`. Radius: `sm/md/lg/xl/full`. Shadows: `xs..lg`, restrained (elevation, not decoration).

**Motion** — durations `fast 120ms / base 200ms / slow 320ms`; easing `standard, entrance, exit`. Framer Motion for meaningful transitions only; respect `prefers-reduced-motion`.

**Elevation & focus** — visible focus ring on every interactive element (`focus/ring` token); never remove outlines without a replacement.

## 3. Accessibility (AA, enforced)

- Contrast ≥ 4.5:1 text / 3:1 large text & UI; tokens are pre-validated for both themes.
- Full keyboard operability; logical tab order; ⌘K reachable and escapable; focus trapping in modals.
- Semantic HTML + ARIA where needed; live regions for streaming Twin output and briefing updates.
- Touch targets ≥ 44×44px. Motion-reduced variants. Screen-reader labels on icon-only controls.
- a11y checks in CI (axe) block merge on violations.

## 4. Theming

Light + dark from one token set via CSS variables; system-default with manual override. No component reads raw colors — only semantic tokens, so a rebrand is a token change.

## 5. Content & tone (UX copy)

Plain, warm, confident, never hypey. The Twin speaks as a sharp mentor: specific, evidence-first ("strong on X because…"), honest about stretch/risk. Error/empty/approval copy is part of the design system (see `component-library.md` states), not an afterthought — approvals especially must make consequences obvious.
