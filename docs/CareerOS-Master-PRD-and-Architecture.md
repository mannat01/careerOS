# CareerOS — Master PRD & System Architecture

**Status:** Source of truth, v1.0 (Greenfield)
**Owner:** Product / Architecture / UX (this document is the reference all engineering agents build against)
**Last updated:** 2026-07-07

> This is the foundational document. Every feature spec, agent design, and API contract that follows must reference and remain consistent with the decisions here. When a downstream spec disagrees with this document, this document wins until it is explicitly amended.

---

## 0. How to read this document

The document moves from *why* to *what* to *how*:

1. **Strategy** — vision, market, positioning, personas, the wedge.
2. **Product** — the surfaces, the AI Career Twin, the daily automation, prioritization, roadmap.
3. **Architecture** — system design, data model, API contracts, agent architecture, security, scaling, cost.
4. **Execution** — build sequence, acceptance criteria, risks, open decisions.

Two principles are load-bearing and appear repeatedly, so state them once:

- **Compliance is a design constraint, not a feature.** The most tempting version of CareerOS — a bot that logs into LinkedIn and mass-applies — is prohibited by every major platform's ToS and gets user accounts banned. We design the *legal, durable* version and treat that constraint as a moat, not a limitation (see §3.9 and §7).
- **The user is always in the loop at the moment of consequence.** The Twin can research, draft, score, and prepare autonomously. It does not *submit an application, send a message, or represent the user to a third party* without explicit approval. This is both an ethics stance and a trust-building product mechanic.

---

# PART I — STRATEGY

## 1. Vision

**CareerOS is an AI-native career operating system: a single place where an AI "Career Twin" continuously works alongside you to improve your career outcomes.**

Today a job seeker's career life is scattered across a resume Word doc, a LinkedIn profile, a spreadsheet of applications, three job boards, a Notion page of interview notes, and their own memory. Every tool is a point solution and nothing compounds. The user does the integration work by hand, repeatedly, under stress.

CareerOS collapses this into one system with a persistent intelligence layer. The Twin holds a durable model of who you are, what you want, and what you've done — and it uses that model to discover opportunities, tailor materials, prepare you for interviews, close skill gaps, and learn from every outcome. The career artifacts (resume, portfolio, applications) become *outputs* of the intelligence layer rather than things you maintain by hand.

**The test of success:** a user should feel that their career is *being actively worked on* even when they're not looking — and that the system knows them well enough that its suggestions feel like they came from a sharp mentor who has read everything they've ever written.

## 2. Market & timing

The AI career-coach market is estimated around **$5–5.5B in 2025, growing to ~$14.8B by 2030 (~22% CAGR)** by one source, with a more aggressive estimate reaching **$23.5B by 2034 (~18.7% CAGR)**. (Figures are analyst estimates and vary widely; treat as directional, not precise — see Sources.) Regardless of the exact number, three tailwinds are real and reinforcing:

- **AI has made tailoring cheap.** What used to take a human 45 minutes (rewrite a resume for one job) is now seconds. This resets user expectations about how personalized job search should be.
- **Application volume has exploded and collapsed signal.** AI lets candidates apply everywhere, so recruiters drown, ATS filters harden, and *differentiated, genuinely-matched* applications become more valuable than volume. This favors a quality/intelligence play over a spray-and-pray play.
- **Careers are less linear.** Reskilling, lateral moves, and portfolio careers are normal. People increasingly want a *system* that thinks across a whole career, not a tool for one job hunt.

**Timing risk:** the incumbents (LinkedIn especially) can add AI features fast. Our defensibility is not any single AI feature — it's the compounding personal data model (the Twin's memory) and the trust relationship. Those take time to build and are expensive to switch away from.

## 3. Competitive landscape & positioning

| Player | What it is | Strength | Gap CareerOS exploits |
|---|---|---|---|
| **LinkedIn** | Network + jobs + profile | Distribution, graph, employer side | Not personal, not agentic, monetizes both sides so never fully the candidate's advocate |
| **Teal** | Resume builder + tracker | Honest match scoring, tailoring | Session-based tool, no persistent intelligence, no automation |
| **Huntr** | Job-search CRM (Kanban) | Clean tracking, clipper | Tracker not a brain; you still do the thinking |
| **Simplify** | Autofill copilot | Best free one-click autofill | Autofill is a feature, not a system; no memory/coaching |
| **Careerflow** | AI job-search suite | Broad feature set | Feature-bundle, weak unifying intelligence |
| **Final Round AI / Interview Warmup** | Interview practice | Strong mock interviews | Point solution; disconnected from the rest of your search |

**The pattern:** the market is a pile of *point tools* (tracker, builder, autofiller, interview practicer). Nobody has built the *operating system* with a persistent intelligence layer underneath that makes every point capability smarter because it shares one memory of the user.

**Positioning statement:**
> For ambitious professionals who treat their career as something worth investing in, CareerOS is the AI career operating system that continuously works to improve your outcomes — because a Career Twin that truly knows you does the discovery, tailoring, and preparation that you'd otherwise do alone, by hand, badly, under stress. Unlike point tools that forget you between sessions, CareerOS gets smarter about you every day.

**What we deliberately are NOT (v1):** not a recruiting/employer product, not a social network, not a mass-apply bot, not a generic LLM chat wrapper.

## 4. Personas & the three-sided lens

Every feature is evaluated from four viewpoints (user, recruiter, hiring manager, business). The primary customer is the candidate; the other lenses are how we make sure the candidate actually *wins*.

**Primary personas**

- **"Maya" — the ambitious early-career switcher (25–32).** 2–5 yrs experience, wants to level up or pivot (e.g., support → PM). High anxiety, low process. Needs: structure, confidence, tailoring, gap-closing. Willingness to pay: moderate; converts on emotional relief + visible momentum.
- **"David" — the senior passive candidate (35–50).** Employed, not urgently looking, open to the right thing. Needs: high-signal opportunity radar, discreet materials kept warm, negotiation intelligence. Willingness to pay: high; converts on *time saved* and *quality of matches*.
- **"Sam" — the active laid-off professional (any age).** Under time and financial pressure, applying at volume. Needs: throughput without spam, morale, prioritization. Willingness to pay: price-sensitive but high intent; converts on *momentum + results*.

**Adjacent lenses (used to shape features, not sold to in v1)**

- **Recruiter view:** what makes an application rise? Genuine match, ATS-parseable resume, evidence over adjectives, a reason this person wants *this* role. CareerOS optimizes for the recruiter's actual decision, not for gaming filters.
- **Hiring-manager view:** can this person do the job and will they stick? The Twin should help the user surface real evidence and tell a coherent narrative, not keyword-stuff.
- **Business view:** the durable asset is the *personal data model + trust*, monetized via subscription (see §12), expandable later into coaching marketplaces, employer-side matching (opt-in), and premium intelligence.

## 5. The wedge (what we build first, and why)

We do **not** launch all nine surfaces at once. The wedge is the loop that creates a compounding data moat fastest while delivering standalone value on day one:

**Wedge = Resume Intelligence + Career Twin memory + a genuinely good daily Opportunity Briefing.**

Rationale: the resume/profile import is the fastest way to bootstrap the Twin's memory (rich structured data about the user in minutes). A daily briefing creates a *habit and a reason to return*, which most tools lack. Tailoring + tracking are table stakes that make it immediately useful. Everything else (portfolio, deep interview prep, analytics, full automation) layers on top of the memory the wedge captures.

---

# PART II — PRODUCT

## 6. Product surfaces (the nine, organized)

The nine capabilities are not nine tabs. They are organized around the Twin:

**A. Identity layer** — *what the Twin knows*
- **Portfolio & Profile** — the canonical, structured record of the user's experience, projects, skills, and artifacts. Public shareable portfolio is a byproduct.
- **Personal Knowledge Management** — notes, saved job posts, interview debriefs, career journal; all feed Twin memory.

**B. Materials layer** — *what the Twin produces*
- **Resume Intelligence** — a structured resume model (not a document) rendered to ATS-safe formats, tailored per opportunity, with match scoring and evidence surfacing.
- **Cover letters & outreach drafts** — generated, never auto-sent.

**C. Opportunity layer** — *what the Twin finds and manages*
- **Job Discovery** — sanctioned-source aggregation, scored and explained.
- **Application Management** — pipeline/CRM, status, deadlines, follow-ups.

**D. Growth layer** — *how the Twin improves the user*
- **Interview Preparation** — role-specific question generation, mock interviews, evidence-backed answer coaching.
- **Skill Development** — gap analysis vs. targets, learning recommendations, progress tracking.

**E. Intelligence layer** — *how the Twin reasons and reports*
- **Career Analytics** — funnel metrics, what's working, market positioning.
- **AI Automation** — the daily loop (§8) orchestrating all of the above.

## 7. The Career Intelligence Engine (central intelligence)

> **Amendment A1 (2026-07-07) — supersedes the original "AI Career Twin."** The central intelligence layer is now the **Career Intelligence Engine (CIE)**. This is an *evolution, not a redesign*: everything in §7.1–§7.4 below is preserved and still true. The "Twin" is retained as the **conversational surface of the CIE** — the voice the user talks to — while the CIE is the larger persistent strategic system behind it. All prior references to "the Twin" as the intelligence layer now mean "the CIE"; references to the Twin as a chat/voice surface still hold. The full expansion is specified in **Part II-A**. The three load-bearing invariants (autonomy boundary in code, human-in-loop at consequence, sanctioned sources only) are unchanged and apply to every CIE capability.

The CIE is the product. Everything else is a surface onto it. At its core (unchanged from the original Twin design) it is a **persistent, memory-backed, tool-using agent system** with a strict autonomy boundary. Amendment A1 expands it from a task assistant into a persistent *career strategist* (Part II-A).

### 7.1 What the Twin is (and isn't)
It is a long-lived agent with: a durable memory of the user, a set of tools (search, score, draft, analyze), a reasoning loop, and a learning mechanism. It is **not** a single prompt or a stateless chatbot. Each "skill" (tailor a resume, prep an interview) is a bounded capability the orchestrator invokes — not a monolith.

### 7.2 Memory model (the moat)
Four tiers, each with different persistence and retrieval characteristics:

- **Profile memory (structured, authoritative):** the canonical entities — experiences, skills, projects, education, preferences, goals. Source of truth, human-editable, versioned. Stored relationally + as embeddings for retrieval.
- **Episodic memory (events):** applications, interviews, outcomes, briefings, user decisions ("skipped this job because too much travel"). Time-stamped, append-only log. This is what lets the Twin *learn the user's revealed preferences*, not just stated ones.
- **Semantic memory (derived beliefs):** compact, LLM-distilled statements about the user ("communicates best with concrete metrics," "targeting Series B PM roles in fintech, remote-first, ≥$160k"). Regenerated periodically from profile + episodic memory; always regenerable, never authoritative.
- **Working memory (session):** the current task context, retrieved slices of the above, assembled per request.

**Retrieval:** hybrid — structured queries for facts, vector search for "find relevant past experiences/notes," and a summarization pass to fit context budgets. Never dump all memory into a prompt; assemble the *minimum relevant slice* per task (cost + quality).

**Preference learning:** every user decision on a Twin suggestion (accept/edit/reject/skip + optional reason) is an episodic event and a training signal for scoring/ranking. Stated preferences seed the model; revealed preferences refine it.

### 7.3 Autonomy boundary (trust contract)
Three tiers, user-configurable, defaulting conservative:

- **Green (auto):** research, scoring, drafting, gap analysis, briefing generation, knowledge-base updates. No external side effects.
- **Yellow (approve-then-act):** anything that leaves the system with the user's name on it — application submission, outreach messages, portfolio publishing. Requires explicit per-item or batched approval.
- **Red (never automated):** authenticating into third-party accounts as the user, accepting/declining offers, anything a platform ToS prohibits, anything irreversible with legal/financial weight.

This boundary is enforced in code (a capability-gating layer), not left to prompt discipline.

### 7.4 Learning from outcomes
Closed loop: application → response (or silence) → interview → offer/reject. Outcomes are attributed back to the choices that produced them (which framing, which match rationale, which resume variant). Aggregated *across users* (privacy-preserving, opt-in), this becomes market intelligence: "resumes emphasizing X for role Y see higher callback." Per user, it tunes the Twin's recommendations. This is the flywheel — more usage → better memory + better market model → better outcomes → more usage.

## 8. The daily automation loop (8:00 AM briefing)

The showcase workflow. A scheduled orchestration that runs each morning and produces a single briefing the user reviews with their coffee. **Critical:** every step respects the autonomy boundary — the loop *prepares*, the user *decides*.

**Sequence (orchestrated agents, each a bounded step):**

1. **Refresh profile context** — assemble current Twin memory, goals, active targets.
2. **Discover opportunities** — pull new postings from *sanctioned sources only* (see §3.9 below): ATS public APIs (Greenhouse, Lever, Ashby), licensed aggregators (e.g., Adzuna), government feeds (USAJobs), and user-connected inboxes/alerts. No scraping of ToS-protected boards.
3. **Score & rank** — each opportunity scored on fit (skills, seniority, domain, comp, location/remote, trajectory) with a transparent sub-score breakdown.
4. **Explain matches** — for each top opportunity, a plain-language rationale ("strong on X and Y; stretch on Z") — never a black-box number.
5. **Identify gaps** — per opportunity and in aggregate, what's missing vs. the user's targets; feeds Skill Development.
6. **Tailor resume (draft)** — generate a tailored resume variant for the top opportunities; store as drafts, do not send.
7. **Draft cover letter / outreach** — optional per opportunity; drafts only.
8. **Prepare interview material** — for opportunities the user is likely to pursue or already in pipeline, pre-generate likely questions + evidence-backed answer scaffolds.
9. **Update knowledge base** — write episodic events, refresh derived semantic memory, log what changed.
10. **Generate briefing** — one screen: "Here's what I found and did overnight. Approve, edit, or skip." Yellow-tier items queued for one-tap approval.

**Controls that must exist:** frequency and quiet hours; source selection; autonomy tier per action type; per-item and batch approval; a full audit log of everything the Twin did and why; a hard "pause the Twin" switch. Auth to external sources is user-initiated OAuth where the platform *offers* it; where it doesn't, we don't automate against it.

### 3.9 Sanctioned-source policy (non-negotiable)
Referenced above and in §7.3/§15. Discovery and any external action run **only** through: (a) official ATS/job public APIs, (b) licensed/commercial job-data aggregators under contract, (c) government open feeds, (d) data the *user* connects via OAuth (their own email alerts, their own accounts acting under their own session with their consent for read). We do **not** scrape LinkedIn/Indeed/Glassdoor or automate logged-in actions against platforms that prohibit it. Auto-submission of applications is disabled by default and, where a destination's ToS forbids automated submission, disabled entirely — the user submits, we prepare. This is a legal requirement (ToS/CFAA exposure, account bans) and a positioning advantage (we're the candidate's durable, safe advocate).

## 9. Feature prioritization (RICE-lite)

Scored on Reach × Impact × Confidence ÷ Effort, then bucketed. Ordered within bucket.

**P0 — the wedge (launch):**
1. Profile/resume import → Twin memory bootstrap (unlocks everything).
2. Structured resume model + ATS-safe render + per-job tailoring + match score with explanation.
3. Job discovery via 2–3 sanctioned sources, scored + explained.
4. Application pipeline (tracking, status, deadlines).
5. Daily Opportunity Briefing (a *manual-trigger* version first, then scheduled).
6. The Twin conversational surface (ask it anything about your search; it uses memory).

**P1 — deepen the loop:**
7. Full scheduled 8AM automation with approval queue + audit log.
8. Interview prep (question gen + mock + answer coaching).
9. Skill gap analysis + learning recommendations.
10. Cover letter / outreach drafting.
11. Public portfolio generation.

**P2 — compound & expand:**
12. Career analytics dashboard + market positioning.
13. Cross-user market intelligence (privacy-preserving).
14. Negotiation intelligence.
15. Plugin architecture / third-party skills.
16. Personal knowledge management surface (journal, notes).

**Explicitly deferred:** employer/recruiter side, coaching marketplace, mobile-native apps (start responsive web/PWA), any auto-submission.

## 10. User journeys (condensed)

**Onboarding (first 10 minutes) — the "wow" must land here.** User signs up → imports resume/LinkedIn export/answers a short structured interview → the Twin *immediately reflects them back*: "Here's what I understand about you and where I think you're headed — correct me." Within minutes it shows 3–5 real scored opportunities with explanations and one tailored resume. The emotional beat: *"it already gets me."* This is the single most important screen in the product.

**Daily loop (steady state).** Morning briefing notification → open one screen → review overnight work → approve/edit/skip in a few taps → optionally chat with the Twin → close. Under five minutes to feel on top of the search.

**Deep work (as needed).** Enter an opportunity → see match breakdown, tailored resume, gaps, prep material → iterate with the Twin → mark as applied (user submits) → Twin tracks and follows up.

**Outcome & learning.** Log an interview/outcome → Twin debriefs, updates memory, adjusts strategy → over weeks, analytics show what's working.

## 11. Success metrics

- **North Star:** *weekly active users who advanced their search* (applied, interviewed, or progressed a pipeline stage) — outcomes, not vanity logins.
- **Activation:** % of new users who reach "first tailored resume + first tracked opportunity" in session one (target: >60%).
- **Twin trust:** approval rate and edit-vs-reject ratio on Twin suggestions; % of users who enable scheduled automation.
- **Retention:** D7/D30; briefing open rate.
- **Outcome:** application→response rate and interview rate vs. self-reported baseline; time-to-offer.
- **Business:** free→paid conversion, churn, LTV/CAC.
- **Guardrail:** spam/complaint signals, ToS incidents (must be ~0), Twin factual-error reports.

## 12. Business model (brief)

Freemium SaaS. Free: memory + limited tailoring + limited discovery + manual briefing. Paid (~$20–35/mo, priced against Huntr/Teal tier and validated later): scheduled automation, unlimited tailoring, full source coverage, interview prep, analytics. Later expansion: premium market intelligence, opt-in employer matching, coaching marketplace, plugins/API. Durable asset = the personal data model; monetize the *ongoing work*, not one-time documents.

---

# PART II-A — AMENDMENT A1: THE CAREER INTELLIGENCE ENGINE (CIE)

**Status:** Amends Part II (§7 especially) and extends §8, §11, §16. Preserves everything already specified. This is the intelligence layer's evolution from *assistant* to *strategist*.

## A1.0 What changes and what doesn't

**Reframe:** CareerOS is not a job-search assistant with AI features; it is an **AI career strategist** whose core is a persistent Career Intelligence Engine that reasons about the user's career over months and years. The engine's default question shifts from *"what jobs match this resume?"* to *"what should this person do now to maximize where they'll be in 1–5 years — and why?"*

**Preserved (do not re-litigate):** the vision (§1), the wedge/sequencing philosophy (§5) — we still ship the standalone value first and layer strategy on top of the memory it captures — the three invariants (autonomy boundary in code, human-in-loop at consequence, sanctioned-sources-only), the business model, and the entire Part III architecture *shape* (modular monolith + workers, relational+vector, tiered LLMs, async agents). The CIE is built **on** that architecture, extending it (graph store, reasoning/planning services, research workers) rather than replacing it.

**The CIE has six capabilities (A1.1–A1.6), all sitting on the existing memory + agent foundation:**
1. **Career State Model** — a continuously-updated dynamic model of the user.
2. **Career Knowledge Graph** — memory expanded from records into a connected graph the engine reasons *across*.
3. **Strategic Reasoning & Decision Support** — proactive, transparent, confidence-scored recommendations and alternative evaluation.
4. **Career Strategy Planner** — adaptive 30-day / 90-day / 1-year / 3-year / 5-year plans.
5. **Autonomous Research Agents** — continuous market/skill/company monitoring synthesized into actions.
6. **Intelligence Dashboards** — the metrics that make career trajectory legible, each explained.

## A1.1 Career State Model (the dynamic model of the user)

A living, versioned model the CIE maintains and updates from both **explicit input** and **observed behavior**. It is the semantic layer of memory (§7.2) promoted to a first-class, structured, continuously-scored artifact.

Dimensions tracked (each with a value, a **confidence**, provenance, and a freshness timestamp):
career goals; interests; strengths; weaknesses; demonstrated skills; inferred skills; **learning velocity**; preferred industries; preferred company sizes; compensation goals; geographic preferences; work-style preferences; values; **leadership readiness**; communication style; interview performance; portfolio quality; recruiter engagement; and the user's position relative to market trends.

Rules: every dimension is **evidence-linked** (traceable to graph nodes/events), **confidence-scored**, **user-correctable**, and **regenerable**. Demonstrated vs. inferred skills are distinct (inferred are proposals until confirmed — never asserted as fact on a resume; the zero-fabrication invariant holds). The model *evolves*: each outcome, decision, and research finding nudges the relevant dimensions, and the engine records *why* it moved (an episodic event), so the trajectory of the model is itself inspectable.

## A1.2 Career Knowledge Graph (memory as a graph)

The memory system (§7.2) is expanded into a **Career Knowledge Graph**: nodes are entities — people, companies, recruiters, interviews, resumes, projects, certifications, skills, industries, applications, outcomes, learning resources, opportunities — and edges are typed relationships (`worked_at`, `requires_skill`, `interviewed_with`, `led_to_outcome`, `builds_toward_goal`, `taught_by_resource`, `competes_with`, `reports_to`, …). The engine reasons **across** the graph (multi-hop) rather than over isolated records — e.g., "this project demonstrates skill X, which three target roles require and the user currently under-evidences, and which market research flags as rising 20% YoY."

Implementation note (detail in Part III amendment): the graph is a **property-graph layer over Postgres** (nodes/edges tables + typed edges) with embeddings on nodes, queried via graph traversal + vector retrieval, abstracted behind `GraphMemoryService` so it can migrate to a dedicated graph DB later without touching reasoning code. It supersedes nothing in §7.2 — profile/episodic/semantic/working tiers remain; the graph is how they interconnect.

## A1.3 Strategic reasoning & decision support

The CIE proactively answers strategic questions, each with **transparent reasoning + a confidence score + the evidence it used**:
should the user apply for this role, or wait for stronger opportunities? which of two offers is objectively better (multi-factor, weighted by the user's own values/goals)? which skills have the highest market demand *and* the highest personal leverage? which experiences are limiting future growth? which projects/certifications have the best ROI? which companies best align with long-term goals? is the user ready for promotion? **is the current strategy working?**

**Decision-support contract:** before any important career decision, the engine (a) enumerates alternatives, (b) explains trade-offs, (c) estimates likely outcomes with confidence and states its assumptions, and (d) recommends the highest-value path — while making clear the user decides. Every recommendation is framed as *evidence → reasoning → confidence → recommendation*, never a bare verdict. Recommendations are **optionality-aware**: the engine values moves that preserve or create future options, not only immediate fit.

**Scope/consequence note:** strategic recommendations are Green (advisory, no external side effect). Acting on them (applying, sending, accepting) remains Yellow/Red per the unchanged autonomy boundary. The engine advises; the human decides and acts.

## A1.4 Career Strategy Planner

Generates and maintains **multi-horizon plans — 30-day, 90-day, 1-year, 3-year, 5-year** — that ladder up to the user's stated long-term goals. Each plan is a set of objectives with rationale, sequenced actions (skills to build, projects to ship, certifications to earn, roles to target, people to reach), expected impact, and confidence. Plans are **adaptive**: they re-generate automatically when the Career State Model, goals, graph, or market research change materially — and every change is explained ("moved the AWS cert earlier because three of your target roles now list it as required and demand rose"). Shorter horizons are concrete and action-level; longer horizons are directional and optionality-oriented. The 8AM briefing (§8) becomes, in part, the daily surfacing of "today's move" from the active 30-day plan.

## A1.5 Autonomous research agents

Continuous, scheduled research workers that monitor and synthesize (via **sanctioned sources and licensed data only** — the §3.9 policy applies fully; no scraping): hiring trends, salary trends, in-demand and emerging skills, emerging technologies, certifications, company news, and industry shifts. Findings are written to the graph as evidence nodes and **synthesized into personalized, actionable recommendations** tied to the user's state and plan (not a generic news feed). Research runs on its own cadence (not only 8AM), is cost-budgeted (cheap models for scanning/classification, frontier for synthesis), and every finding that influences a recommendation is cited and inspectable. Aggregated, opt-in, de-identified signals also feed the cross-user market model (§7.4) — privacy rules unchanged.

## A1.6 Intelligence dashboards

Surfaces that make trajectory legible. Each metric shows a value, a trend, and **why it matters + how to move it** (never a bare number — consistent with the "show the reasoning" UX principle, §16):
career momentum; interview readiness; skill momentum; market positioning; salary trajectory; opportunity quality; networking strength; recruiter engagement; portfolio completeness; and the current strategic recommendations. Metrics are computed from the Career State Model + graph + research, are drill-down-able to their evidence, and link directly to the plan action that improves them. Dashboards are a *read* surface over the CIE; they introduce no new autonomy.

## A1.7 Success metrics (extends §11)

Add CIE-specific measures to the §11 set: **plan adherence** (actions completed vs. planned) and **plan→outcome correlation**; **recommendation acceptance rate + calibration** (did outcomes match stated confidence — a model-quality guardrail); **Career State Model freshness/coverage**; **strategy-is-working signal** movement over time; and long-horizon retention (the CIE's value compounds monthly/annually, so measure multi-month retention, not just D30). North Star is unchanged but reinterpreted: users whose *career trajectory* measurably advances, not just whose weekly search advances.

## A1.8 Engineering impact (pointer)

The CIE becomes the platform every module is designed around. Concretely this adds, on top of the existing architecture: a **Career State Model service**, a **Graph memory layer** (`GraphMemoryService`), a **Reasoning/Decision-Support service** (with a structured evidence→reasoning→confidence output contract), a **Strategy Planner service**, **research worker agents**, and a **Dashboard/metrics service**. All reuse the existing capability-gate, LLM gateway, audit, and sanctioned-source connector framework. Details are folded into Part III (§18 amended) and the engineering doc set (`architecture.md`, `database-schema.md`, `api-spec.md`, milestones M02, M04–M08).

---

# PART III — ARCHITECTURE

## 13. System architecture

**Shape:** a modular monolith at the core with cleanly separated agent/worker services — not premature microservices. Rationale: a small team ships faster and reasons better with a well-modularized monolith; the parts that genuinely need independent scaling (agent execution, ingestion) are split out as async workers from day one. Extract services later along the seams we design now.

**Layers**

- **Client:** responsive web app / PWA (Next.js/React). Fast, keyboard-driven, elegant (see §16). Native mobile deferred.
- **API/BFF:** typed gateway (REST + a thin realtime channel for streaming Twin responses and briefing updates). AuthN/Z, rate limiting, request assembly.
- **Core domain services (modular monolith):** Identity/Profile, Resume, Opportunity, Application, Prep, Analytics. Each owns its data and exposes internal interfaces.
- **Twin / Agent layer (separate service):** the orchestrator + bounded skill-agents + tool registry + capability-gating (autonomy boundary) + memory retrieval. Runs both synchronously (chat) and via the scheduler (8AM loop). Stateless workers pulling from a job queue.
- **Ingestion/Connectors layer (separate workers):** sanctioned-source fetchers (ATS APIs, aggregators, gov feeds, user OAuth inbox), normalization to a canonical Opportunity schema, dedup, embedding.
- **Data layer:** primary relational DB, vector store, object storage, cache, message queue, feature/event store.
- **Cross-cutting:** observability (traces across agent steps — critical for debugging non-deterministic flows), audit log, secrets, feature flags, cost metering per LLM call.

**Async by default for the Twin.** The 8AM loop and any multi-step agent run are queued jobs with checkpoints, retries, and idempotency — never a long synchronous request. The briefing is *assembled overnight and read in the morning*; the user never waits on the loop.

## 14. Data model (core entities)

Relational core, with embeddings alongside for retrieval. Key entities and relationships:

- **User** (auth, settings, autonomy-tier config, subscription).
- **Profile** 1—1 User: the canonical identity root.
- **Experience / Project / Education / SkillClaim** N—1 Profile: structured, versioned, each with an embedding and provenance (imported vs. user-entered vs. Twin-inferred-and-confirmed).
- **ResumeModel** N—1 Profile: a *structured resume* (selected + ordered + phrased experiences), not a file. **ResumeVariant** N—1 ResumeModel: a tailored version bound to an Opportunity, with the render artifact in object storage and the diff/rationale stored.
- **Opportunity**: canonical normalized job (source, source-id, company, role, comp, location/remote, requirements-parsed, raw payload, ingested-at). Deduped across sources.
- **MatchScore** N—1 (Profile, Opportunity): overall + sub-scores + generated explanation + model/version stamp (for reproducibility).
- **Application** N—1 (User, Opportunity): status (enum: saved→drafting→ready→applied→screening→interviewing→offer→closed), timeline, linked ResumeVariant + documents, follow-up schedule. *Submission is a user action logged here; the system does not transition to "applied" on the user's behalf externally.*
- **InterviewPrep / MockSession**: generated questions, user answers, feedback, scores, linked to Opportunity/Application.
- **SkillGap / LearningItem**: identified gaps + recommended resources + progress.
- **MemoryEvent** (episodic): append-only log of Twin actions and user decisions (type, payload, timestamp, rationale, autonomy-tier).
- **DerivedInsight** (semantic): regenerable distilled beliefs about the user, with source references and freshness timestamp.
- **BriefingRun**: one scheduled/triggered loop execution — inputs, steps, outputs, approvals, cost, status; the audit backbone.

**Data ownership & portability:** the user owns all of it; full export and hard-delete are first-class (§15). Provenance on every inferred fact so the user can see *why the Twin believes something* and correct it.

## 15. Security, privacy & compliance

This is a system holding a person's most sensitive professional data and acting on their behalf. Treat it accordingly.

- **AuthN:** managed auth provider, SSO + passkeys, MFA available. No rolling our own crypto.
- **AuthZ:** every query scoped to the owning user; row-level enforcement; the agent layer runs under the *user's* permission scope, never a god-mode service account when touching user data.
- **Capability gating:** the autonomy boundary (§7.3) is enforced as a middleware every tool call passes through — Yellow/Red actions cannot execute without a matching approval token. Prompt-level instructions are backup, not the control.
- **Data protection:** encryption in transit + at rest; field-level encryption for the most sensitive PII; tenant isolation; secrets in a vault; least-privilege service creds.
- **Third-party tokens:** user OAuth tokens for connected sources stored encrypted, scoped read-only where possible, revocable by the user in one click.
- **Privacy/regulatory:** GDPR/CCPA-aligned from day one — consent-driven data use, purpose limitation, full export, hard delete, DPA-ready. Cross-user market intelligence is opt-in and de-identified/aggregated; never expose one user's data to another.
- **LLM-specific risks:** no training on user data without explicit opt-in; PII minimization in prompts (send the minimum slice); output filtering; prompt-injection defense on any ingested job text (treat scraped/aggregated content as untrusted — it can contain adversarial instructions); guardrails against the Twin fabricating experience on a resume (a hard product rule: **the Twin never invents credentials or experience**).
- **ToS compliance (§3.9):** codified as an allow-list of sources and actions; anything not on the list is blocked at the connector layer.
- **Auditability:** every Twin action logged immutably (who/what/when/why/which model), surfaced to the user and retained for support/trust.

## 16. UX direction

Inspired by Apple (clarity, restraint), Linear (speed, keyboard, opinionated defaults), Spotify (personalized, alive), Arc (playful, spatial), Notion (flexible blocks), Vercel (calm technical polish). Priorities: **simplicity, elegance, speed, discoverability, emotional engagement.**

**Principles**
- **One primary surface: the Briefing/Home.** The user should almost always land somewhere that says "here's what matters now and what I did for you." Not a dashboard of twelve widgets — a calm, prioritized narrative.
- **The Twin is ambient, not a chatbot in a corner.** It speaks through the briefing, inline suggestions, and a command surface (⌘K) — available everywhere, never demanding a separate "chat mode."
- **Show the reasoning.** Every score, match, and suggestion is expandable to *why*. Trust is built by transparency, not confidence theater.
- **Momentum as a feeling.** Progress, streaks (gentle, not gamified-annoying), "the Twin worked overnight" — the emotional payload is *you are not doing this alone and things are moving.*
- **Speed is a feature.** Instant navigation, optimistic UI, keyboard-first, streaming responses. It should feel like Linear, not like a slow SaaS form.

**Key screens (v1):** Onboarding/import → "here's what I understand about you"; Home/Briefing; Opportunity detail (match breakdown + tailored resume + prep); Pipeline (Kanban); Resume studio; Interview prep room; Twin command surface (⌘K everywhere). Full component/flow specs are separate UX documents that inherit these principles.

## 17. Scaling & cost

- **Scale path:** stateless API + agent workers scale horizontally; DB starts single-primary with read replicas, partition/shard later along user_id (designed for now, not built yet). Ingestion is queue-buffered so source spikes never hit the DB directly.
- **The real cost driver is LLM inference, not infra.** Controls: (1) tiered models — cheap/fast models for scoring, ranking, extraction; frontier models only for high-value generation (tailoring, coaching, reasoning). (2) Aggressive caching and dedup — a job posting is embedded/parsed once, not per user. (3) Minimum-slice memory retrieval, not context dumps. (4) Batch the overnight loop for efficiency. (5) Per-user cost metering with budget caps that gate the free tier. Unit economics must be modeled per active user before scaling spend — a naive "frontier model for every step for every user every morning" design does not survive contact with a P&L.
- **Reliability:** the 8AM loop is idempotent and checkpointed; partial failure yields a partial briefing plus a flagged retry, never a blank screen. Third-party source outages degrade gracefully (skip source, note it, continue).

## 18. Agent architecture (CIE internals)

> **Amendment A1:** the agent layer is the CIE's execution substrate. In addition to the skill-agents below, the CIE adds long-lived services — Career State Model, Graph memory, Reasoning/Decision-Support, Strategy Planner, Research agents, Dashboard/metrics (Part II-A §A1.8) — all of which invoke skill-agents and reuse the capability-gate, LLM gateway, memory service, and audit. The orchestrator now plans across two cadences: reactive (chat/decision) and continuous (research + plan maintenance), not only the daily loop.


- **Orchestrator:** owns the plan for a request or the daily loop; decomposes into bounded skill-agent calls; enforces the autonomy boundary; manages context assembly and cost budget per run.
- **Skill-agents (bounded):** Discoverer, Scorer/Explainer, Tailor, Gap-Analyzer, Cover/Outreach-Drafter, Interviewer, Debriefer, Briefing-Composer. Each has a tight input/output contract and its own eval suite. Bounded agents are testable and debuggable; a single mega-agent is neither.
- **Tool registry:** typed tools (search sources, read/write memory, render resume, schedule follow-up), each declaring its autonomy tier. The capability-gate wraps every tool.
- **Memory service:** the retrieval/assembly/summarization layer (§7.2) all agents call — the single path to user memory.
- **Evaluation harness:** golden datasets + rubric-based LLM/human evals per skill-agent, regression-gated in CI. Non-deterministic systems need eval gates the way deterministic systems need unit tests. Track quality, cost, and latency per agent version.
- **Observability:** distributed tracing across every agent step and tool call, tied to the BriefingRun/audit log — mandatory, because you cannot debug an agent flow you can't see.

## 19. Plugin architecture (P2, designed-for now)

Skills as a registry of typed capabilities with declared inputs/outputs, permissions, and autonomy tier lets us — and later third parties — add capabilities (a "salary-negotiation" skill, an "H1B-aware discovery" skill) without touching the core. Design the skill-agent contract in v1 so this is an extension, not a rewrite. Third-party plugins run sandboxed, under the same capability-gate and the user's permission scope.

---

# PART IV — EXECUTION

## 20. Build sequence (implementation-ready phases)

**Phase 0 — Foundations (weeks 0–3):** repo/infra, auth, data model core (User/Profile/Experience/Opportunity/Application), observability + audit skeleton, capability-gate stub, one sanctioned source integrated end-to-end (Greenhouse or Lever public API — no-auth, lowest friction).

**Phase 1 — The wedge (weeks 3–10):** resume import → memory bootstrap; structured resume model + ATS render + tailoring + explained match score; discovery from 2–3 sources; pipeline; **manual-trigger** briefing; Twin command surface over memory. Ship this; it's a standalone product.

**Phase 2 — The loop (weeks 10–18):** scheduler + full 8AM automation with approval queue + audit UI; interview prep; skill-gap analysis; cover/outreach drafts; portfolio. Turn on autonomy tiers.

**Phase 3 — Compound (18+):** analytics + market positioning; opt-in cross-user intelligence; negotiation; plugin contract exposed; PKM surface.

Each phase ships usable value; nothing is a big-bang.

## 21. Acceptance criteria (P0 samples — pattern for all specs)

- *Resume import:* given a PDF/DOCX/LinkedIn export, ≥90% of experiences/skills extracted into structured entities with provenance; user can correct any field; corrections persist to Profile memory.
- *Tailoring:* given a Profile + Opportunity, produce an ATS-parseable resume variant in <20s (p95) that uses only real profile facts (zero fabricated experience — verified by eval), with a stored diff + rationale.
- *Match score:* every score exposes sub-scores + a plain-language explanation; identical inputs + model version reproduce the score.
- *Autonomy boundary:* no Yellow/Red action executes without a valid approval token; attempts are logged and blocked (covered by an automated security test).
- *Briefing:* a run completes idempotently; partial source failure yields a partial briefing with flagged retries, never an error screen; every action in the run appears in the audit log.

## 22. Testing requirements

Unit/integration for domain services; **eval suites per skill-agent** (quality + cost + latency, regression-gated in CI); security tests for authZ scoping and capability-gating; prompt-injection tests on ingested job text; load tests on the ingestion queue and the batched overnight loop; a "zero-fabrication" eval that must pass before any tailoring ships.

## 23. Top risks & mitigations

- **ToS/legal (high):** mitigated by the sanctioned-source allow-list + human-in-loop submission (§3.9, §15). This is existential — treat any proposal to scrape/auto-submit as a launch blocker.
- **LLM cost blows up unit economics (high):** tiered models, caching/dedup, min-slice retrieval, per-user budgets (§17). Model unit economics before scaling.
- **Twin fabricates credentials (high, trust-killing):** hard product rule + zero-fabrication eval gate (§15, §21).
- **Incumbent (LinkedIn) copies features (medium):** defensibility is the memory moat + trust, not any feature; compound the data.
- **"Feels like a gimmick" / low trust (medium):** transparency (show reasoning), conservative autonomy defaults, land the onboarding "it gets me" moment (§10, §16).
- **Cold-start opportunity quality (medium):** start with high-signal sanctioned sources + user-connected alerts; quality over coverage early.

## 24. Open decisions (need a call before/early in build)

1. **Primary source mix for P0** — which 2–3 sanctioned sources give the best quality/coverage/legal profile to start (ATS public APIs + one licensed aggregator + USAJobs)?
2. **Comp/pricing tier** — validate the ~$20–35 point and exactly which capabilities gate free→paid.
3. **Model vendor strategy** — single frontier vendor vs. multi-vendor routing from day one (affects cost controls and the tiered-model design).
4. **How opinionated is onboarding?** — resume-import-first vs. structured-interview-first for the fastest "it gets me" moment.
5. **Portfolio in P1 vs. P2** — is a public portfolio a wedge amplifier (shareable growth loop) or a distraction from the core loop?

---

### Sources (market/competitive/compliance grounding; analyst figures are directional)
- AI career-coach market size — Research and Markets / The Business Research Company / market.us (est. $5–5.5B 2025 → ~$14.8B 2030 @ ~22% CAGR; alt. $23.5B 2034 @ ~18.7%).
- Competitive tools (Teal, Huntr, Simplify, Careerflow) — Careerflow, Huntr, RemoteHunt, Toolworthy comparison articles (2026).
- LinkedIn automation/scraping ToS — LinkedIn Help ("Prohibited software," "Automated activity"), LinkedIn User Agreement; hiQ v. LinkedIn context.
- Sanctioned job-data sources — Greenhouse/Lever public APIs, Unified.to ATS API, aggregator/ATS API roundups (Cavuno, fantastic.jobs).
- Interview prep landscape — Final Round AI, Google Interview Warmup.
