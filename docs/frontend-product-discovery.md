# CareerOS — Product Discovery & Frontend Product Specification

**Stage:** Discovery + product spec. **No implementation code** (per mandate). Ends with a recommended path and a hard stop for approval.
**Basis:** authored PRD/architecture/API/milestone specs + review of all 10 build milestones (M01–M10). Where an exact API/enum is cited, it is high-confidence from the build record; the live repo would confirm the last specifics.
**Rule I'm holding:** the frontend must *reinforce* the backend's guarantees, never weaken or hide them. Every screen decision below is judged against that.

---

# PART A — WHAT PRODUCT ALREADY EXISTS INSIDE THE BACKEND

Before designing anything, here is the product the engine already *is* — discovered from its capabilities and contracts, not imagined.

## A1. The one-sentence truth
The backend is **an AI career strategist that is structurally incapable of lying to you or about you, and that never takes a consequential action without your explicit approval.** Everything else — résumés, jobs, plans, research, interviews — is an expression of that.

## A2. The capability surface that actually shipped (the product's real API)
Grouped by what a user would experience, mapped to the endpoints built:

**Identity & understanding** — `POST /v1/profile/import` (résumé → structured facts, ≥90% recall, zero fabrication), profile CRUD; `GET /v1/cie/state` + `/state/:dimension/explain` + `/recompute` (the Career State Model: ~12+ dimensions, each with a value, **calibrated confidence**, **provenance**, and **evidence refs**); `GET /v1/cie/graph` (the career knowledge graph — multi-hop, per-user scoped).

**Materials** — `POST /v1/resumes/:id/tailor` → a `ResumeVariant` grounded in real facts only, with a stored diff + rationale + ATS check; `GET /v1/opportunities/:id/match` (a `MatchScore`: overall + subscores + **explanation**, honest about gaps, reproducible & persisted); drafts (`POST /v1/drafts`, `GET /:id`, `POST /:id/send` — send is **Yellow + ToS-gated**); portfolio (`POST /v1/portfolio`, `/publish` **Yellow**, `GET /public/:slug` serving only a frozen published snapshot).

**Opportunities & pipeline** — `GET /v1/opportunities` (filters + cursor pagination; sanctioned sources: Greenhouse, Lever, USAJobs; cross-source dedup), `/:id` (sanitized detail); `GET/POST /v1/applications`, `PATCH /:id` (state machine `saved→…→applied→…→offer→closed`, where **`applied` is settable only by an explicit user action — never by an agent**), follow-ups.

**Strategy & reasoning** — `POST /v1/cie/decide` (the decision contract: alternatives, evidence, reasoning, **calibrated confidence**, assumptions, recommendation, optionality — *never a bare verdict*, willing to say "hold, you're not ready"); `POST /v1/cie/decide/offers` (objective comparison weighted by the user's real stated values); `POST /v1/cie/negotiation` (advisory; **accept/decline is Red — never automated**); `GET/POST /v1/cie/plans` + `/:horizon` + `/regenerate` + `PATCH /actions/:id` + "today's move" (30d/90d/1y/3y/5y adaptive plans that regenerate only on material change, with an explained diff).

**Autonomy & briefings** — `POST /v1/briefings/run` + `GET /:id` + `/latest` + item `approve|edit|skip`; a scheduled overnight loop (quiet hours, idempotent, partial-on-failure, budget-capped); the capability-gate with **live autonomy tiers** (Green/Yellow/Red) configurable in `UserSettings`; `GET /v1/audit` (immutable log of every allow/deny with who/what/when/why/model).

**Growth & self-knowledge** — interview prep (grounded answer scaffolds + honest-gap strategies; `honest_bridge` vs `address_gap`), `GET /v1/skills/gaps` + `/learning`, `GET /v1/cie/research` + `/research/feed` + `/recommendations` (personalized, cited, sanctioned-source-only), `GET /v1/cie/dashboards` + `/:metric` (10 metrics, each with an explanation and **`insufficient_data` instead of an invented number**), `GET /v1/cie/calibration` ("is the system's confidence honest?"), PKM (`/v1/pkm`), plugins (sandboxed).

**The Twin** — `/rt/twin` streaming (SSE), assembles a **min-slice** memory context per turn, invokes the reasoner as a tool, and **emits `approval_required` and stops** the instant a chat request would trigger a Yellow action. Chat is not a backdoor around the gate.

## A3. The non-negotiable guarantees (these are PRODUCT, not plumbing)
Every one is enforced in code and tested; the UI's job is to make each *visible and felt*:

1. **Never fabricates** — every claim, score, insight, metric, and answer is recomputed from real evidence; the model's output is discarded and reground. → *UI: evidence/"why" is everywhere; nothing is a bare number.*
2. **Human-in-the-loop at consequence** — Yellow actions need explicit approval; `applied`/publish/send require it; **accept-offer and auth-as-user are Red (never automated).** → *UI: a consistent, unmissable approval language.*
3. **Calibrated confidence** — the system measures whether its own "70%" is honest and corrects itself; thin evidence → low confidence or `insufficient_data`. → *UI: confidence is shown as a first-class, honest signal, never hidden or inflated.*
4. **Sanctioned sources only** — no scraping; citations restricted to an allow-list. → *UI: source attribution on everything the system claims about the market.*
5. **Privacy & ownership** — per-user scoping, opt-in only for cross-user intelligence (k-anon, de-identified), full export + hard delete. → *UI: the user can always see and control what's known about them.*

## A4. Who it serves (grounded in the personas the engine optimizes for)
- **Primary:** the ambitious professional treating their career as an investment — the early-career switcher ("Maya"), the senior passive candidate ("David"), the active job-seeker under pressure ("Sam"). The engine's depth (multi-horizon planning, calibrated reasoning) rewards people who want a *strategist*, not a form-filler.
- **Secondary (implicit):** anyone the user shares a **published portfolio** with (a recruiter/hiring manager reading `/public/:slug`). This is the only outward-facing surface and deserves distinct, polished treatment.

## A5. How a user moves through it (the natural journey the API implies)
Import → *"here's what I understand about you"* (state model reflect-back) → see scored, explained opportunities → tailor materials / ask "should I apply?" → track applications (you submit) → get a daily briefing of overnight work you approve → follow an adaptive plan → prep for interviews → watch honest dashboards → the system learns and gets better calibrated. The **briefing is the recurring heartbeat**; the **Twin is the ambient companion**; **approval is the recurring moment of control.**

---

# PART B — CHALLENGE TO YOUR ASSUMPTIONS (the stronger product the repo reveals)

You asked me to push back if the engine implies a sharper product than the original vision. It does, in three ways.

## B1. Reposition: *visible trust* is the product, not a feature
The market is flooded with AI career tools that hallucinate confident nonsense, keyword-stuff résumés, and mass-apply until accounts get banned. This engine is the opposite by construction. **That is the category-defining wedge, and it should be the hero of the interface, not a safety disclaimer in settings.**

Concretely, the three things most products *hide*, this product should *celebrate as UI*:
- **Provenance** ("here's exactly where this came from"),
- **Confidence** ("here's how sure I am — and I've proven my confidence is honest"),
- **The approval boundary** ("I prepared this; you decide").

Recommendation: make these three the spine of the design system (see Part C). The tagline the product earns: **"The career AI that won't lie to you, about you, or act behind your back."** The competitor's demo looks magical and is often wrong; ours should look *trustworthy and be right* — and the UI should make that difference legible in five seconds.

## B2. Simplify the IA: ~10 backend surfaces → 5 rooms + an ambient companion
A naive frontend would ship ~12 tabs (state, graph, resumes, opportunities, applications, plans, dashboards, research, skills, drafts, portfolio, calibration…). That would bury the product. The engine's surfaces cluster naturally into **five rooms**:
1. **Today** (the briefing/home) · 2. **Opportunities** (discover + pipeline + per-job decision) · 3. **Plan** (strategy + skills + dashboards) · 4. **You** (state model + materials + portfolio + notes) · 5. **Approvals** (the Yellow inbox + audit).
Plus the **Twin (⌘K)** — ambient, on every screen, never a tab — and **Settings**.
Everything else is a *view inside* a room, not a top-level destination. Merge aggressively; a strategist product should feel calm, not like a dashboard of dashboards.

## B3. Rename toward the trust story
- Keep "Twin" for the conversational companion (it's warm and it's the voice).
- Rename internal jargon for users: "Career State Model" → **"What CareerOS understands about you"** (a page you can read and correct); "MatchScore explanation" → **"Why this fit"**; "autonomy tier" → surfaced as **"Auto / Needs your OK / Never automatic."**
- Frame `insufficient_data` not as an error but as **"Not enough signal yet"** with a path to build it — honesty as a feature, not an apology.

*If you disagree with any of B1–B3, this is the moment to redirect — everything in Part C is built on these three calls.*

---

# PART C — PRODUCT SPECIFICATION

## C1. Product vision
CareerOS is the AI career strategist you can trust with the most important decisions of your working life — because it shows its work, admits what it doesn't know, and never acts without your say-so. It turns a résumé into a living understanding of you, then works alongside you (and overnight, with your permission) to move your career forward, honestly.

## C2. Users & goals
- **Primary — the career investor** (switcher / passive senior / active seeker). Goals: *understand where I really stand*, *find opportunities that actually fit*, *present myself honestly but at my best*, *decide well (apply or hold, which offer)*, *make steady progress without spam or anxiety*, *stay in control.*
- **Secondary — the recruiter/hiring manager** viewing a published portfolio. Goal: *quickly assess a real, evidence-backed candidate.* (Read-only, outward-facing, no login.)
- **Tertiary (later) — plugin developers.** Goal: *extend CareerOS safely.* (Out of V1 UI scope.)

## C3. Core workflows (the vertical slices the UI must serve)
1. **Onboard & be understood** — import → reflect-back state model (confidence + provenance, editable) → first scored opportunities + first tailored résumé. *The "it gets me" moment.*
2. **Discover & decide** — browse scored opportunities → open one → see "why this fit," tailored résumé, prep, and "should I apply?" (honest decision) → save/track. **User submits externally; user marks it applied.**
3. **The daily briefing** — open Today → see today's move, overnight findings, top opportunities, and a small queue of things that need your OK → approve/edit/skip.
4. **Plan & grow** — read the multi-horizon plan → see skill gaps → track learning → watch honest dashboards move.
5. **Prepare** — generate interview prep grounded in real experience → practice → debrief.
6. **Represent** — tailor résumé variants, draft outreach (send is Yellow/ToS-gated), publish a portfolio (Yellow).
7. **Control & trust** — set autonomy tiers, connect sources, review the audit log, read "is the system's confidence honest?" (calibration), export or delete everything.

## C4. Information architecture & navigation
**Primary nav (persistent, left rail on desktop / bottom tabs on mobile):**
- **Today** (default landing) — the briefing.
- **Opportunities** — discover + pipeline (one surface, two views: list/board).
- **Plan** — strategy plan + skills + dashboards.
- **You** — state model + materials (résumés, drafts) + portfolio + notes.
- **Approvals** — Yellow inbox (with a count badge) + audit log. *Badge, not clutter.*

**Global, non-tab:**
- **Twin (⌘K / floating affordance)** — ambient on every screen; streams; surfaces `approval_required` inline.
- **Settings** — autonomy tiers, sources/connections, briefing schedule + quiet hours, data (export/delete), calibration, opt-ins.

**Depth rule:** each room has a *list/overview* and a *detail* (e.g., Opportunities → an opportunity; Plan → a horizon; You → a state dimension or a résumé variant). Max two levels before content. No feature gets promoted to top-level just because it has an endpoint.

## C5. Screen inventory (V1 in **bold**, later plain)
- **Onboarding: import → reflect-back → first results** (the hero flow)
- **Today / Briefing** (today's move, overnight summary, top opportunities, approvals peek) — V1 manual-trigger; V2 scheduled
- **Opportunities list** (filters, source badges, match score + "why") · **Opportunity detail** (why-this-fit breakdown, tailored résumé, prep, **"should I apply?"** decision card)
- **Pipeline board** (Kanban; the applied-guard interaction) 
- **Résumé studio** (structured model + variant + diff/rationale + ATS check)
- **You / State model** ("what CareerOS understands about you" — dimensions with confidence, provenance, evidence, inline edit) · **Career graph explorer** (V2)
- **Approvals inbox** (Yellow items: approve/edit/skip, with exact payload) · **Audit log**
- **Twin panel** (⌘K, streaming, evidence-cited)
- **Settings** (autonomy, sources, schedule/quiet-hours, data & privacy, calibration)
- Plan / horizons + today's move (V2) · Dashboards (V2) · Skills & learning (V2) · Interview prep room (V2) · Drafts/outreach (V2) · Research feed (V2) · Offer comparison + negotiation (V2) · Portfolio editor + **public portfolio page** (V2; public page polished) · PKM/notes (V2) · Calibration ("my confidence") (V2) · Plugins (V3)

## C6. Feature prioritization (rationale = the wedge, mapping to backend stages)
- **V1 (wedge — surfaces M01–M05):** onboarding/reflect-back, Today (manual briefing), Opportunities + match + decision, Pipeline (with applied-guard), Résumé studio + tailoring, the Twin, You/State model, Approvals + audit, Settings (autonomy/sources/data). *This is a standalone, trustworthy product.*
- **V2 (the strategist — surfaces M06–M08 + growth):** scheduled automation + deeper approval queue, Plan/horizons + today's move, Dashboards, Skills, Interview prep, Drafts, Research feed, Offers/negotiation, Portfolio + public page, Calibration.
- **V3:** PKM surface, plugin management, cross-user market-intel views.

## C7. AI touchpoints — and the four things each must always answer
Every AI surface (import, state model, tailoring, match, decide/offers/negotiation, planner, research, interview prep, drafts, dashboards, Twin) must make legible: **(1) what it knows** (the evidence it used), **(2) what it doesn't** (gaps / `insufficient_data` / confidence), **(3) where it came from** (provenance/source), **(4) what needs your approval and what happens next** (tier + next step). This is a *component contract*, not a per-screen decision (see C11).

## C8. Approval touchpoints (the trust moments)
- **Yellow (needs your OK):** submit-assist / mark **applied** (user-only), send a draft (also ToS-gated → may become "send it yourself" with guidance), publish portfolio, approve a briefing item, delete account/export.
- **Red (never automatic, no UI path to automate):** accept/decline an offer, authenticate as the user into a third party, any ToS-prohibited send.
- **UX rule:** an approval modal always shows *exactly what will happen*, the *payload/preview*, the *tier*, and — for ToS-gated — the honest "we can't send this for you here; here's the text to send yourself." Editing after approval **invalidates** the approval (mirrors the backend). Never a silent action.

## C9. Trust-building opportunities (the design system's reason to exist)
- **Autonomy tier as a visual language** — a consistent Green / Yellow / Red treatment (color **+ icon + label**, never color alone) wherever an action or item appears. Users should learn "yellow = my call" within the first session.
- **The ubiquitous "Why?"** — an evidence/provenance popover on every score, insight, metric, plan action, and recommendation. Clicking a number *always* reveals the facts behind it. This is the single most differentiating interaction.
- **Confidence, shown honestly** — calibrated confidence bands on CIE outputs; a link to "is this confidence trustworthy?" (calibration). Bare numbers are banned in the UI as they are in the backend.
- **Honest empty states** — `insufficient_data` renders as "Not enough signal yet + how to build it," not a spinner or a fake zero.
- **Provenance tags** on profile facts (imported / you added / AI-inferred-and-you-confirmed / from your notes). The user can always see *why* the system believes something and correct it.
- **The audit log as a feature** — "everything CareerOS has done, and why" is a trust asset, surfaced calmly, not buried.

## C10. Accessibility (WCAG 2.1 AA — a hard requirement, already a backend/design-system commitment)
Keyboard-first (Linear-grade), ⌘K reachable and escapable, visible focus, logical order, focus-trapped modals; **live regions** for streaming Twin output and briefing composition; semantic structure + ARIA on icon-only controls; **tier status never conveyed by color alone** (icon + text label); contrast ≥ AA in both themes; touch targets ≥44px; `prefers-reduced-motion` honored (the product favors calm over animation anyway). a11y checks gate the build.

## C11. Empty / loading / error states (first-class, not afterthoughts)
- **Loading:** the briefing is an async *run* — show its steps composing (discovery → scoring → gaps → focus) rather than an opaque spinner; Twin streams token-by-token with a live region; pipeline moves are optimistic with rollback; skeletons for lists.
- **Empty:** no opportunities → "connect a source / broaden filters"; no plan → "set a goal to generate one"; `insufficient_data` dashboards → honest "not enough signal yet"; **empty Approvals → a *calm* "nothing needs you right now"** (an empty approvals inbox is a feature, not a void).
- **Error & recovery (map the real backend error model):** `partial` briefing → show what composed + the failed step's retry (never blank); `capability_denied` → surface the approval path, or for ToS-gated sends the manual-send guidance (never a dead end); `source_not_allowed` → explain the sanctioned-source policy positively; `rate_limited` (budget) → the upgrade path; `401` → re-auth; validation (422) → inline field errors. **The UI never masks a validation or safety failure — it explains it.**

## C12. Onboarding experience (the make-or-break)
The single most important flow. Sequence: **import** (résumé/LinkedIn export/paste) → a visible, honest extraction (with the zero-fabrication promise made tangible — "we only used what's actually in your résumé") → **the reflect-back**: "Here's what I understand about you" (state dimensions with confidence + provenance, immediately correctable) → **first proof of value**: 3–5 scored opportunities with "why," and one tailored résumé → a light setup of **conservative autonomy defaults** (explained, not buried), optional source connections, and briefing schedule. The emotional target of the reflect-back screen: *"it already gets me — and it's being honest about what it's unsure of."* Everything else in the product is downstream of nailing this.

---

# PART D — RECOMMENDED PATH (and the stop)

## D1. What I recommend we do next (in order)
1. **You react to Parts A–C** — especially the three challenges in Part B (trust-as-hero positioning, the 5-room IA, the renames). These are load-bearing; I don't want to design the architecture on assumptions you'd reject.
2. **Frontend architecture spec** (next document, no code): the committed stack and structure — routing, state/data layer, the typed API client + streaming (SSE) layer, auth (Clerk in prod / Dev in local, mirroring the backend), the design-system/token foundation, the trust-component contracts (TierBadge, WhyPopover, ConfidenceChip, ApprovalDialog, ProvenanceTag), testing (unit + a11y + e2e against the real API), performance, and deployment/observability. Design-system choices should inherit the backend's existing `design-system.md`/`component-library.md` so there's one source of truth.
3. **Milestone-based build** — coherent vertical slices, each: build → explain → verify against the backend → test (incl. a11y + the trust-guarantee tests) → self-review → note tech debt → **stop for approval.** Proposed slice order mirrors the wedge: **FM1** app shell + auth + API/streaming client + design-system core + the trust components (TierBadge/WhyPopover/ConfidenceChip/ApprovalDialog); **FM2** onboarding import + reflect-back; **FM3** Opportunities + match + decision; **FM4** Résumé studio + tailoring; **FM5** Today/briefing + Approvals + Twin; then V2 rooms.

## D2. A hard rule I'm committing to for the whole frontend
The frontend will be tested not just for correctness but for **guarantee-preservation**: automated checks that the UI cannot submit a Yellow action without an approval token, cannot present a CIE output without its evidence/confidence, cannot render a bare fabricated number, and cannot offer a path to a Red action. The backend proves these server-side; the UI must not create a softer path around them. These become first-class frontend tests, the mirror of the backend's security/eval gates.

## D3. Open questions for you (small, but they shape the build)
- **Platform priority:** responsive web-first (recommended, matches the backend intent) — confirm we're not doing native yet.
- **Design starting point:** build the design system fresh from the existing tokens, or are there brand assets/Figma to honor?
- **The public portfolio page:** is it in scope for V1 or V2? (It's the only outward-facing surface; I've placed it V2, but it could be a growth lever worth pulling earlier.)
- **Repo access for me:** if you want the architecture spec grounded in the *exact* API response shapes (not my high-confidence reconstruction), authorize the GitHub connector or share the repo — otherwise I'll spec against the API contract as I know it and we verify per-slice.

---

**Stopping here for your approval, per the working protocol.** No frontend code, no architecture commitments yet — just the understanding and the product spec, with three real challenges to your original framing. Tell me where you agree, where you'd redirect, and answer the four questions in D3, and I'll produce the frontend architecture spec next (still no app code until you approve *that*).
