# FM1 Work Order — Foundation + Trust Kit

**Milestone:** FM1 (first frontend slice) · **Complexity:** L (≈2–3 eng-weeks) · **Depends on:** the backend (M01–M10, feature-complete) running locally on docker
**Specs:** `frontend-product-discovery.md` (product) + `frontend-architecture.md` (architecture). Those are authoritative; this expands them into an ordered work order.

**Why this milestone exists:** FM1 builds *no product features on purpose.* It proves the trust architecture — the components and types that make it structurally impossible for later features to weaken a backend guarantee — **before** any feature depends on it. If the Trust Kit is right, FM2–FM5 are fast and safe. If it's wrong and we discover that in FM4, we rewrite five screens.

**Demo path at the end:** a signed-in user sees the app shell with the five rooms; a kitchen-sink route renders every Trust Kit component against **real API data**; the ⌘K Twin streams a live response from `/rt/twin`; a deliberate Yellow action without approval is blocked *and cannot even be expressed in code*; axe + guarantee tests are green in CI.

---

## Objectives
1. Stand up `apps/web` in the monorepo with the committed stack, wired to the **real backend** (dev auth locally).
2. Build the **typed API client + SSE streaming client** over the shared `@careeros/contracts` schemas — the frontend imports the contract, never re-declares it.
3. Build the **Trust Kit** (`src/trust/`) with type-level enforcement of the guarantees.
4. Establish the **design-system core** from the existing tokens (incl. tier + confidence semantics).
5. Establish the **app shell + navigation** (five rooms) and auth.
6. Establish **CI gates**: unit, a11y (axe), and the **guarantee suite** scaffolding.

## Dependencies
Backend running locally (`make up` + migrations + seed) with `AUTH_PROVIDER=dev`. No FM2+ features.

### What already EXISTS vs. what FM1 CREATES — read first (prevents false "missing spec" stops)
**Exists in the backend — consume, do not build:** all `/v1/*` endpoints from M01–M10 (`/v1/me`, `/v1/profile/import`, `/v1/cie/state|graph|decide|plans|dashboards|research|calibration`, `/v1/opportunities`, `/v1/applications`, `/v1/briefings`, `/v1/audit`, `/v1/drafts`, `/v1/portfolio`, `/v1/skills`, `/v1/pkm`) and the **`/rt/twin` SSE endpoint shipped in M05 Step 4** (event union `context|token|tool_call|tool_result|approval_required|done|error`).
> **Verify, don't assume:** before flagging `/rt/twin` as missing, grep properly — e.g. `rg -n "rt/twin|approval_required|twin" apps/api/src` and check `apps/api/test/twin.e2e.test.ts`. It shipped as **POST + SSE**, not WebSocket; searching for a WS route or a GET handler gives a false negative. If genuinely absent after that check, STOP and report — that would be a real finding.

**Does NOT exist — FM1 creates it (all in `apps/web` / `packages/ui`):** the entire frontend (currently an empty stub), the **Trust Kit** (`<AiSurface>`, `<TierBadge>`, `<WhyPopover>`, `<ConfidenceChip>`, `<ProvenanceTag>`, `<ApprovalDialog>`, `<InsufficientData>`) — fully specified in **`docs/frontend-architecture.md §5`**; the typed API + SSE client (§4); the design-system token extension (§6); the app shell (§2–3); and the dev-only `/_dev/trust` page (task 8). **Their absence is expected — building them IS the milestone.** Do not treat "component X does not exist yet" as a missing spec.

---

## Sequenced tasks

### 1. App scaffold + config — S
- [ ] Create `apps/web` (Next.js App Router, TS strict) in the monorepo; wire into turbo/pnpm workspaces; Tailwind configured against the shared token preset.
- [ ] Typed config module (the ONLY place reading env): API base URL, auth provider (`dev|clerk`), OTel endpoint. Fail fast on missing/invalid.
- [ ] Route groups per `frontend-architecture.md §2`: `(marketing)`, `(auth)`, `(app)`, `onboarding`.
- **Accept:** `pnpm --filter @careeros/web dev` boots; `pnpm -w typecheck` + `pnpm -w lint` clean (canonical `pnpm -w lint`, not cached).

### 2. Design-system core — M
- [ ] Port tokens from `design-system.md` into `packages/ui` (or extend it): semantic colors, **`tier/green|yellow|red`**, **`confidence/low|med|high`**, type scale, 4px spacing, radii, elevation, motion (120/200/320) with `prefers-reduced-motion`.
- [ ] Dual light/dark via CSS variables. Wrap the shadcn/Radix primitives once so app code never touches raw colors.
- [ ] Lint rule (or documented convention + test) that fails on hard-coded hex in `apps/web`.
- **Accept:** a token/theme smoke test renders both themes; contrast of tier + confidence tokens verified ≥AA in both.

### 3. Typed API client — L
- [ ] `src/api/client.ts`: fetch wrapper with bearer auth, **shared-zod response parsing** (fail loudly on drift in dev/test), typed `ApiError { code, message, details, traceId }` mapping every backend code (`unauthenticated`, `forbidden`, `not_found`, `validation_failed`, `rate_limited`, `capability_denied`, `source_not_allowed`, `conflict`, `internal`), `Idempotency-Key` on mutating POSTs, trace propagation.
- [ ] **Type-level approval enforcement:** model Yellow-tier mutations so they *require* an `ApprovalToken` argument — a Yellow call without a token must be a **compile error**, not a runtime check. Red-tier actions have **no client function at all**.
- [ ] `userId` is never a client-supplied parameter anywhere.
- [ ] Domain modules (thin, typed) for the endpoints FM1 needs: `me`, `profile`, `cie/state`, `opportunities`, `briefings`, `audit`. (Others land with their features.)
- **Accept:** unit tests for error mapping + idempotency; a **compile-fail test** (e.g. `expect-type`/`tsd`-style or a documented `@ts-expect-error` case) proving a Yellow call without a token does not typecheck.

### 4. SSE streaming client — M
- [ ] `src/api/stream.ts`: typed async iterator over the `/rt/twin` event union (`context`, `token`, `tool_call`, `tool_result`, `approval_required`, `done`, `error`); reconnect/abort handling; parse errors surfaced, never swallowed.
- **Accept:** unit tests over a mocked stream incl. malformed frames; **`approval_required` halts consumption** and surfaces for handoff (never auto-continues).

### 5. The Trust Kit (`src/trust/`) — L · **the heart of this milestone**
Build per `frontend-architecture.md §5`, each with all states, keyboard + SR support, token-only styling, and tests:
- [ ] `<TierBadge tier>` — **icon + label + color** (never color alone).
- [ ] `<WhyPopover subject evidence[] reasoning>` — the universal "why"; evidence refs resolvable.
- [ ] `<ConfidenceChip confidence source>` — band + value; links to calibration.
- [ ] `<ProvenanceTag provenance>` — imported / user / inferred-confirmed / from-notes.
- [ ] `<ApprovalDialog action payload tier onApprove>` — the ONLY path to a Yellow action; shows exactly what will happen + payload preview + tier; mints/consumes the token; **payload edit invalidates a prior approval**; renders ToS-gated denial as honest manual-send guidance.
- [ ] `<InsufficientData reason next>` — "not enough signal yet" + how to build it; **never a number**.
- [ ] `<AiSurface>` wrapper — **requires evidence + confidence (+ tier where relevant) as props; missing them is a type error.**
- **Accept:** each component's states covered; axe-clean; the type-level requirement of `AiSurface` proven by a compile-fail case.

### 6. App shell, nav, auth — M
- [ ] Shell: left rail (desktop) / bottom tabs (mobile) for the five rooms — **Today, Opportunities, Plan, You, Approvals** — with an approvals **count badge**; Twin mount point; toast region; skip-link + landmarks.
- [ ] Auth provider abstraction: **Dev-JWT** (local/CI/e2e) + **Clerk** (prod, behind config); guarded `(app)` routes; server-side onboarding-completeness check; 401 → transparent retry once → clear re-sign-in.
- [ ] Placeholder room pages (empty states only — no features yet), each with a correct, designed empty state.
- **Accept:** keyboard-only navigation across the shell; focus visible; rooms reachable; unauthenticated redirect works.

### 7. State/loading/error primitives — S
- [ ] Route skeletons, list skeleton, ARIA **live region** helper (for streaming/composing), optimistic-mutation helper with rollback, and the error-recovery renderer mapping each `ApiError.code` to its designed path (per `frontend-architecture.md §9`) — incl. `capability_denied` → approval path or manual-send guidance; `partial` → show composed + retry; `500` → show `traceId`.
- **Accept:** unit tests per error code proving a recovery affordance is always rendered (no silent no-op).

### 8. Kitchen-sink verification route (dev-only) — S
> **Clarification:** this is a **NEW FRONTEND page you build in `apps/web`** (a Next.js route), **not** an existing or new backend endpoint. It does not exist yet — creating it is the deliverable. It calls the *existing* backend read endpoints.
- [ ] `apps/web/app/(app)/_dev/trust/page.tsx` (dev-only, excluded from prod build): renders every Trust Kit component against **real backend responses** (`GET /v1/cie/state`, an opportunity match, an audit entry, a briefing item).
- **Accept:** this is the milestone's "verify against the backend" evidence — real data, real shapes, no mocks.

### 9. CI gates — M
- [ ] Add to the existing CI: `web` typecheck + lint, **unit tests**, **axe a11y** on every implemented route (blocking), and the **guarantee suite** (below). Reuse the canonical `pnpm -w lint` (no turbo cache masking).
- [ ] **MSW handlers generated from `@careeros/contracts`** so mocks can't drift.

---

## Guarantee suite (launch-blocker class — scaffolded in FM1, extended every milestone)
Automated, CI-blocking. FM1 must implement these:
1. A **Yellow action without an approval token does not compile** (type-level) and is rejected at runtime if forced.
2. **Editing a payload after approval invalidates** the prior approval (dialog state test).
3. **No Red action has any UI path** — an inventory test asserts no client function/route exists for Red-tier actions.
4. **`AiSurface` cannot render without evidence + confidence** (type-level + runtime assertion).
5. **`insufficient_data` never renders as a number.**
6. **`capability_denied` never yields a silent no-op** — a recovery affordance is always present.

---

## Acceptance criteria (milestone-level)
- Shell + five rooms navigable, keyboard-only, axe-clean; unauthenticated redirect enforced server-side.
- API client parses real backend responses via shared schemas; every error code maps to a designed recovery.
- Twin streams a real response from `/rt/twin`; `approval_required` halts and hands off.
- Every Trust Kit component renders against **real** backend data on the kitchen-sink route.
- All six guarantee tests pass; a11y gate green; typecheck + canonical lint clean; madge/boundary rules clean.
- No feature code from FM2+ (no onboarding, no opportunity list, no résumé studio).

## Testing requirements
Unit (components, hooks, error mapping, stream parser) · contract tests via MSW-from-zod · **a11y (axe) blocking, incl. keyboard-only approval-dialog path** · the **guarantee suite** · at least one Playwright smoke: sign in (dev auth) → shell renders → ⌘K opens → Twin streams.

## Files/modules expected to change (create)
`apps/web/**` (app router groups, shell, dev route), `apps/web/src/{api,trust,components,lib,test}/**`, `packages/ui/**` (tokens + wrapped primitives), root CI workflow, workspace config.

## Out of scope for FM1
Onboarding/import, opportunities, résumé studio, briefing content, plan/dashboards, portfolio, plugins. Placeholder rooms only.

---

## §Kickoff prompt (paste to Cline)

> FM1 — Foundation + Trust Kit (first frontend milestone). Read, in order: `CLAUDE.md`, `docs/frontend-product-discovery.md`, `docs/frontend-architecture.md`, `docs/frontend-milestone-01-workorder.md`, plus `docs/api-spec.md` and `docs/design-system.md` for the contracts and tokens.
>
> Precheck: the backend runs locally (`make up`, migrations + seed applied, `AUTH_PROVIDER=dev`) and `pnpm -w test` + `eval:ci` are green. Report the baseline.
>
> Then execute `docs/frontend-milestone-01-workorder.md` top to bottom, one task per small commit referencing the task. **Build NO product features** — FM1 is the foundation + Trust Kit only, with placeholder room pages.
>
> Non-negotiables: `apps/web` imports types from `@careeros/contracts` (never re-declare API shapes); Yellow-tier API calls must **require an approval token at the type level** (a call without one must fail typecheck) and Red-tier actions must have **no client function at all**; `<AiSurface>` must require evidence + confidence as props; `userId` is never client-supplied; token-only styling (no hard-coded colors); the canonical `pnpm -w lint` before every push.
>
> Verify against the REAL backend via the dev-only kitchen-sink route (`/_dev/trust`) — real responses, not mocks — and stream a real `/rt/twin` turn. Implement all six guarantee tests and make axe blocking in CI.
>
> When done: report (1) what you built and where, (2) why any non-obvious choice was made, (3) the backend-verification evidence (real responses rendered + a real streamed turn), (4) the exact test commands + results (unit, a11y, guarantee suite, Playwright smoke), (5) the CI `build-test` conclusion from the Actions tab, (6) a self-review incl. technical debt and recommended improvements. Then STOP and wait for approval — do not start FM2.
