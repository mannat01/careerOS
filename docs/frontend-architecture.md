# CareerOS — Frontend Architecture Specification

**Stage:** architecture design. **Still no application code** — this is the plan to be approved before FM1 begins.
**Companion doc:** `frontend-product-discovery.md` (vision, users, IA, screens, trust model). This document answers *how we build it* so that the product spec is achievable and the backend's guarantees are structurally preserved.
**Governing rule:** the frontend may never create a softer path around a backend guarantee. Where the backend enforces something server-side, the UI mirrors it *and* is tested for it.

---

## 0. Decisions taken on your behalf (reversible — override cheaply)

| # | Decision | Rationale | Cost to reverse |
|---|---|---|---|
| D1 | **Responsive web PWA; no native app** | Matches the backend's stated intent; one codebase; installable. | Low now, high later |
| D2 | **Design system built fresh from existing tokens** (`design-system.md`, `component-library.md`) — no brand assets assumed | One source of truth already exists; avoids inventing a parallel system | Low — tokens are swappable |
| D3 | **Public portfolio page = V2**, but its data contract is designed in V1 | Only outward-facing surface; deserves polish, but the wedge is the logged-in product | Low (contract pre-planned) |
| D4 | **Spec against the known API contract; verify per slice against the live API** | Unblocks progress now; each milestone has an explicit "verify against backend" step | Low — verification is built into the loop |

If you disagree with any, say so before FM1; D1 and D3 are the only ones that get expensive later.

---

## 1. Stack (committed)

Chosen to match the backend monorepo so there is one toolchain, one language, one test runner.

| Concern | Choice | Why this, not the alternative |
|---|---|---|
| Framework | **Next.js (App Router) + React, TypeScript strict** | Already the assumed stack in `master-plan.md §1`; streaming/RSC support; file routing; strong a11y ecosystem. Alternative (Vite SPA) loses streaming + routing conventions for little gain. |
| Location | **`apps/web` in the existing monorepo** | Shares `@careeros/contracts` (zod DTOs) — the single most valuable frontend decision: **the API contract is imported, not re-declared.** |
| Styling | **Tailwind + CSS variables from `packages/ui` tokens** | Token-driven theming already specified; no hard-coded color anywhere. |
| Components | **shadcn/ui + Radix primitives, wrapped once in `packages/ui`** | Accessible primitives (focus traps, ARIA) out of the box; wrapping keeps app code token-pure. |
| Server state | **TanStack Query** | Caching, background refresh, optimistic updates + rollback (pipeline moves), request dedup. Alternative (bare fetch + context) re-implements this badly. |
| Client state | **Zustand** (small, local: ⌘K open, filters, draft edits) | Server state is *not* client state; keeping them separate avoids the classic Redux-as-cache mess. |
| Forms/validation | **react-hook-form + the shared zod schemas** | Client validation uses the *same* schema the server enforces → no drift, no softer client rules. |
| Streaming | **Native `EventSource`/fetch-stream client for `/rt/twin` (SSE)** | Backend chose SSE for testability; a thin typed wrapper parses the event union. |
| Auth | **Clerk (prod) / Dev-JWT (local+CI)** mirroring the backend's two providers | The backend already has `AUTH_PROVIDER=dev|clerk`; the frontend must support both or local/CI dev is impossible. |
| Charts (V2) | **Recharts** | Dashboards are simple trend/bar; heavier libs unjustified. |
| Testing | **Vitest + Testing Library** (unit/integration), **Playwright** (e2e), **axe** (a11y), **MSW** (API mocking) | Same runner as backend; MSW mocks are generated from the shared zod schemas so mocks can't drift from reality. |
| Observability | **OpenTelemetry web + error tracking (Sentry-compatible)** | Mirrors backend tracing; trace ids correlate frontend → API → agent run. |

---

## 2. Application structure

```
apps/web/
├─ app/                          # Next.js App Router
│  ├─ (marketing)/               # public: landing, /p/[slug] public portfolio (V2)
│  ├─ (auth)/                    # sign-in / sign-up (provider-agnostic)
│  ├─ (app)/                     # authenticated shell — the 5 rooms
│  │  ├─ layout.tsx              # nav rail, Twin mount, approval badge, toasts
│  │  ├─ today/                  # briefing (default landing)
│  │  ├─ opportunities/          # list + [id] detail + board view
│  │  ├─ plan/                   # V2: horizons, skills, dashboards
│  │  ├─ you/                    # state model, materials, portfolio, notes
│  │  ├─ approvals/              # Yellow inbox + audit
│  │  └─ settings/               # autonomy, sources, schedule, data & privacy
│  └─ onboarding/                # import → reflect-back → first results
├─ src/
│  ├─ api/                       # typed client: one module per domain
│  │  ├─ client.ts               # fetch wrapper: auth, errors, idempotency, tracing
│  │  ├─ stream.ts               # SSE client for /rt/twin (typed event union)
│  │  └─ <domain>.ts             # profile, cie, opportunities, applications, briefings…
│  ├─ features/                  # feature-scoped UI + hooks (colocated)
│  │  └─ <feature>/{components,hooks,index.ts}
│  ├─ components/                # app-level shared (nav, shell, layout)
│  ├─ trust/                     # THE TRUST KIT (see §5) — the product's spine
│  ├─ lib/                       # utils, formatters, a11y helpers
│  └─ test/                      # MSW handlers, fixtures, harnesses
└─ e2e/                          # Playwright specs (incl. guarantee tests)
```

**Boundary rules (lint-enforced, mirroring the backend's discipline):** `app/` may not call `fetch` directly — only `src/api`. `features/` may not import another feature's internals (only its `index.ts`). `trust/` imports nothing from `features/` (it is the shared spine). No `process.env` outside a single typed config module. No hard-coded colors — tokens only.

---

## 3. Routing & navigation

- **Route groups** separate the three shells: marketing/public, auth, and the authenticated app. The public portfolio (`/p/[slug]`) is deliberately in the *marketing* group: no auth, no app chrome, its own minimal layout, and it renders only the **frozen published snapshot** the backend serves.
- **Server components** for shell/layout and initial data; **client components** for anything interactive/streaming.
- **Deep-linkable state:** filters, board vs list, selected horizon, and drill-downs live in the URL — sharing a link reproduces the view (and makes e2e specs stable).
- **Guarded routes:** the server verifies the httpOnly session and calls explicit Green `POST /v1/me/bootstrap`. The exhaustive decision is `unauthenticated | onboarding_required(MeResponse) | ready(MeResponse) | dependency_error(ApiError)`. `(app)` maps these to sign-in, onboarding, requested route, and visible recovery respectively. `/onboarding` is the inverse guard: sign-in, onboarding flow, Today, visible recovery. Dependency failures never masquerade as signed-out/not-onboarded, and a genuine 401 refreshes once before re-authentication. The only onboarding signal is `MeResponse.onboarding`; profile/fact/state/resource presence and timestamps are forbidden inference inputs. After a contract-validated completion response, the client performs a full `/today` navigation so this server guard reads the newly authoritative state instead of reusing a redirect prefetched while onboarding was still required.

---

## 4. API layer & data flow

**One typed client, no ad-hoc fetches.** `src/api/client.ts` centralizes:
- **Auth:** bearer token from the active provider (Clerk session or dev JWT).
- **Errors:** parses the backend's shared error model into a typed `ApiError { code, message, details, traceId }`, with first-class handling for `capability_denied`, `source_not_allowed`, `rate_limited`, `validation_failed`, `unauthenticated`. **No error is ever swallowed into a generic toast** — each has a designed recovery path (§9).
- **Idempotency:** an `Idempotency-Key` on every mutating POST (required for Yellow-tier actions).
- **Approval tokens:** `X-Approval-Token` attached *only* by the `ApprovalDialog` flow (§5) — never by a plain mutation call. This is enforced by types: Yellow-tier mutations take an `ApprovalToken` parameter and cannot be invoked without one.
- **Tracing:** propagates/records `traceId` so a UI action can be correlated to the backend audit entry.

**Types come from `@careeros/contracts`.** Responses are parsed with the shared zod schemas at the boundary in dev/test (fail loudly on drift) and typed in prod. If the backend changes a contract, the frontend fails at typecheck — not at runtime in front of a user.

The bootstrap guard runs in server components and reads the bearer from the existing httpOnly cookie path; no new token exposure to browser JavaScript is introduced. Dev auth maps the canonical seed email to its fixed UUID and other normalized emails to stable isolated provider principals so real first-run behavior can be exercised without pre-seeding or a production test-only endpoint. The completed FM2 onboarding flow is résumé text import → extraction review → state reflect-back/correction → conservative autonomy review → authoritative completion → Today. Binary PDF/DOCX parsing remains deferred.

**Query conventions:** query keys namespaced by domain + user; cursor pagination via `useInfiniteQuery`; optimistic updates only where the backend is authoritative and rollback is safe (pipeline moves, learning-item progress); **never optimistic for a Yellow action** — those wait for the server.

**Streaming (`/rt/twin`):** `src/api/stream.ts` exposes a typed async iterator over the event union (`context`, `token`, `tool_call`, `tool_result`, `approval_required`, `done`, `error`). The Twin UI renders `context` (the min-slice evidence actually used), streams `token`s into an ARIA live region, and **halts on `approval_required`, handing off to the ApprovalDialog** — never auto-continuing.

---

## 5. The Trust Kit (`src/trust/`) — the architectural heart

These components exist because the *guarantees* exist. They are the mechanism by which the UI reinforces the backend rather than merely consuming it. Every AI surface composes them.

| Component | Contract it enforces |
|---|---|
| **`<TierBadge tier>`** | Green / Yellow / Red rendered with **icon + label + color** (never color alone — a11y + clarity). One visual language everywhere an action or item appears. |
| **`<WhyPopover subject evidence[] reasoning>`** | The universal "why." Any score, insight, metric, plan action, or recommendation must be wrapped in it. Evidence refs resolve to real facts via the drill-down endpoints. |
| **`<ConfidenceChip confidence source>`** | Calibrated confidence as a band + value, linking to "is this confidence honest?" (calibration). |
| **`<ProvenanceTag provenance>`** | imported / you added / AI-inferred-confirmed / from your notes — on every profile fact. |
| **`<ApprovalDialog action payload tier onApprove>`** | The *only* path to a Yellow action. Shows exactly what will happen + the payload preview + the tier; mints/consumes the approval token; **re-editing invalidates a prior approval** (mirrors the backend `payloadHash`). Renders ToS-gated denials as honest "send it yourself" guidance. |
| **`<InsufficientData reason next>`** | Renders `insufficient_data` as "not enough signal yet + how to build it" — never a zero, never a fake value. |
| **`<AiSurface>`** (wrapper) | A structural contract: an AI-produced surface must supply evidence + confidence + (where relevant) tier. **Missing them is a type error, not a design oversight.** |

**This is the enforcement mechanism for "the UI can't weaken the backend."** A developer cannot render a CIE output without its evidence and confidence, because the component types require them.

---

## 6. Design system

Inherits `design-system.md`: semantic color tokens (never raw hex), the **tier** tokens (`tier/green|yellow|red`) and **confidence** tokens (`confidence/low|med|high`) as first-class product semantics, one sans + mono, 4px spacing grid, restrained elevation, motion durations 120/200/320ms with `prefers-reduced-motion` honored. Dual light/dark from one token set via CSS variables.

**Tone:** calm, professional, high-trust. Motion is used for *meaning* (state change, streaming) not decoration. Density is opt-in. The home screen is a prioritized narrative, not a wall of widgets.

---

## 7. Authentication

- Provider abstraction with two implementations mirroring the backend: **Dev-JWT** (local/CI/e2e — deterministic tokens, no external dependency) and **Clerk** (prod).
- Session → bearer token attached by the API client; `userId` is *never* sent by the client as a parameter (the backend derives it from the verified token — the frontend must not create the illusion of client-supplied identity).
- 401 → transparent re-auth then retry once; then a clear re-sign-in path.

---

## 8. Accessibility (WCAG 2.1 AA — gated, not aspirational)

Keyboard-first throughout (⌘K reachable/escapable; visible focus; logical order; focus-trapped dialogs); **ARIA live regions** for Twin streaming and briefing composition; semantic landmarks; labels on icon-only controls; **status never by color alone**; contrast ≥AA both themes; ≥44px targets; reduced-motion variants. **axe runs in CI and blocks the build**; Playwright specs include keyboard-only paths for the approval flow (the highest-stakes interaction must be operable without a mouse).

---

## 9. States: loading, empty, error (designed, not defaulted)

- **Loading:** route-level skeletons; the briefing renders its *steps composing* (discovery → scoring → gaps → focus) rather than an opaque spinner; Twin streams into a live region; optimistic pipeline moves with rollback.
- **Empty:** every empty state names the next action ("connect a source," "set a goal"); an empty Approvals inbox is a *calm confirmation*, not a void.
- **Error recovery, mapped to the real backend model:** `partial` briefing → show what composed + retry the failed step (never blank); `capability_denied` → surface the approval path, or the honest manual-send guidance for ToS-gated channels; `source_not_allowed` → explain the sanctioned-source policy positively; `rate_limited` → budget/upgrade path; `422` → inline field errors from the shared schema; `500` → apologize, show the `traceId`, offer retry. **The UI explains failures; it never masks them.**

---

## 10. Testing strategy (including guarantee tests)

Four layers, all gating CI:
1. **Unit/integration** (Vitest + Testing Library + MSW): components, hooks, error mapping, streaming parser.
2. **Contract tests:** MSW handlers are built from `@careeros/contracts` schemas — a backend contract change breaks frontend tests immediately.
3. **a11y** (axe): every route + the approval dialog; violations fail the build.
4. **e2e** (Playwright against the real API on docker infra): the wedge paths — onboarding→first result, opportunity→decision, tailor→variant, briefing→approve.

**Plus the guarantee suite (the frontend mirror of the backend's security/eval gates) — launch-blocker class:**
- a Yellow action **cannot** be submitted without an approval token (attempted → blocked, and the type system prevents the call);
- editing a payload after approval **invalidates** it;
- **no Red action has any UI path** (asserted by route/action inventory);
- an AI surface **cannot render without evidence + confidence** (type-level + runtime assertion);
- `insufficient_data` **never renders as a number**;
- a `capability_denied` response never results in a silent no-op (a recovery path is always shown).

---

## 11. Performance

Budgets: interaction feedback <100ms; meaningful content <1s on the wedge routes; streaming first token <500ms. Techniques: RSC for shell + initial data, route prefetch on intent, code-split heavy views (graph explorer, charts), virtualized long lists, image/font discipline, TanStack cache tuned per-domain (opportunities cached; approvals always fresh). Measured in CI with Lighthouse budgets on the wedge routes.

---

## 12. Deployment & observability

- **Environments:** local (docker backend + dev auth) → preview per PR → staging → production. Same pipeline discipline as the backend.
- **Build/deploy:** Next.js on a managed platform or container alongside the API; env validated by a typed config module at boot (fail fast).
- **Observability:** OTel web tracing correlated with backend `traceId`; error tracking with source maps; Core Web Vitals; **product analytics gated behind explicit consent** (this product's brand is trust — no silent tracking). Never log PII to the console or to the error tracker.

---

## 13. Milestone plan (vertical slices; each ends with a hard stop for approval)

Each milestone: build → explain what/why → **verify against the live backend** → write + run tests (unit, a11y, guarantee, e2e where applicable) → fix → self-review → list tech debt → recommend improvements → **stop.**

| # | Slice | Ships (user-visible) | Key risk it retires |
|---|---|---|---|
| **FM1** | **Foundation + Trust Kit** | App shell, nav rail, auth (dev+Clerk), typed API client + SSE client, design-system core, the Trust Kit components, error/empty/loading primitives, CI (unit+a11y+guarantee scaffolding) | The whole trust architecture is proven *before* any feature leans on it |
| **FM2** | **Onboarding & "what we understand about you"** | Import → honest extraction → reflect-back state model (confidence + provenance + inline correction) → conservative autonomy defaults | The make-or-break "it gets me" moment |
| **FM3** | **Opportunities & the decision** | Opportunity list + filters + source badges, detail with "why this fit," and the *should I apply?* decision card (evidence/confidence/optionality) | The core value loop; the honest-gap UX |
| **FM4** | **Materials** | Résumé studio: structured model, tailored variant + diff/rationale + ATS check | Making zero-fabrication *visible* in a document |
| **FM5** | **Today, Approvals & the Twin** | Manual briefing with composing steps, the Approvals inbox (+ audit), the ⌘K Twin with streaming + `approval_required` handoff | The autonomy boundary as a felt, everyday interaction |
| **FM6+** | V2 rooms | Plan/horizons + today's move, Dashboards, Skills, Interview prep, Drafts, Research feed, Offers/negotiation, Portfolio + public page, Calibration | — |

FM1–FM5 constitute a **shippable wedge**: a person could genuinely use it.

---

## 14. Technical debt I am accepting deliberately (declared up front)

1. **Public portfolio deferred to V2** (contract designed in V1) — the only outward-facing surface; acceptable because the wedge is the logged-in product.
2. **API shapes verified per-slice rather than up-front** (D4) — mitigated by importing `@careeros/contracts` and failing at typecheck.
3. **Charts deferred to V2** — no chart dependency enters the bundle until Dashboards.
4. **No native app** — PWA install covers the mobile case for now.
5. **Real-model quality is still unproven backend-side** — the frontend must therefore make confidence/evidence *prominent*, so real-model weakness surfaces to users as visible uncertainty rather than confident error. (Design decision, not a workaround.)

---

## 15. What I need from you to start FM1

Approval of this architecture. Optionally: repo/API access if you want exact-shape grounding sooner (otherwise per-slice verification handles it), and a decision if you disagree with D1 or D3 (the two costly-to-reverse defaults).

**Stopping here for approval, per the working protocol. No application code will be written until you approve this architecture.**
