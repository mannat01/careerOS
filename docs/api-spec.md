# CareerOS — API Specification

**Derived from:** PRD §13–§15, `database-schema.md`. REST over HTTPS + a realtime channel (WS/SSE) for Twin streaming and briefing updates. DTOs are zod schemas in `packages/contracts` (single source of truth for client + server).

---

## 1. Conventions

- Base: `/v1`. Realtime namespace: `/rt`.
- Auth: bearer token from managed provider; every request resolves to a `userId`; all queries row-scoped to it.
- Content: JSON. IDs are uuids. Timestamps ISO-8601 UTC.
- Pagination: cursor-based `?cursor=&limit=` → `{ data, nextCursor }`. Default `limit=25`, max `100`.
- Rate limits (defaults, tunable per env): 120 req/min/user on reads, 20/min on mutations; per-source limits from `SourceRegistry.rate_policy`; LLM calls gated by per-user daily budget (free tier lower). Exceeding → `rate_limited` with `Retry-After`.
- Idempotency: mutating POSTs accept `Idempotency-Key` header (required for anything Yellow-tier).
- Versioning: additive changes only within `v1`; breaking → `v2`. DTOs are backward-compatible per `coding-standards.md`.

## 2. Error model

```
{ "error": { "code": "string", "message": "human readable", "details": {...}, "traceId": "otel-id" } }
```
Codes: `unauthenticated` (401), `forbidden` (403), `not_found` (404), `validation_failed` (422), `rate_limited` (429), `capability_denied` (403, autonomy-gate), `source_not_allowed` (403, connector allow-list), `conflict` (409), `internal` (500). `capability_denied` and `source_not_allowed` are first-class so clients render the trust/consent path correctly.

## 3. Capability-gate on the API

Any side-effecting route tagged Yellow requires a valid `ApprovalToken` (header `X-Approval-Token`) bound to `(userId, action, payloadHash)`. Red routes do not exist as callable endpoints. Green routes need no token. Missing/invalid token → `capability_denied`.

## 4. Endpoints by domain

### Auth & account
- `GET /v1/me` → user + settings.
- `PATCH /v1/me/settings` → update autonomy defaults, quiet hours, schedule, source prefs, data-use opt-ins.
- `POST /v1/me/export` → enqueue full data export (Green) → returns job id.
- `DELETE /v1/me` → hard delete (Yellow; requires confirmation token).

### Identity / Profile / Memory
- `POST /v1/profile/import` → upload resume (PDF/DOCX) or LinkedIn export → enqueue extraction job → `{ jobId }`.
- `GET /v1/profile` → profile + experiences/projects/education/skills with **provenance**.
- `POST|PATCH|DELETE /v1/profile/experiences/:id` (and `/projects`, `/education`, `/skills`) → user edits; edits persist as authoritative + emit `MemoryEvent`.
- `POST /v1/profile/insights/regenerate` → rebuild `DerivedInsight` (Green).
- `GET /v1/profile/insights` → derived beliefs + source refs + freshness.

### Resume
- `GET|POST /v1/resumes` → list/create `ResumeModel`.
- `POST /v1/resumes/:id/tailor` `{ opportunityId }` → enqueue Tailor agent → `ResumeVariant` (draft). Green (no external effect).
- `GET /v1/resumes/variants/:id` → variant + diff + rationale + `ats_check`.
- `GET /v1/resumes/variants/:id/render?format=pdf|docx` → signed S3 URL.

### Opportunity & Match
- `GET /v1/opportunities` → discovered, scored, filterable (source, remote, comp, freshness).
- `GET /v1/opportunities/:id` → detail + `raw_payload` (sanitized) + parsed requirements.
- `GET /v1/opportunities/:id/match` → `MatchScore` overall + subscores + **explanation** (always present).

### Application (pipeline)
- `GET|POST /v1/applications` → list/create (status defaults `saved`).
- `PATCH /v1/applications/:id` → update status/notes/follow-up. **Transition to `applied` requires an explicit user action flag**; the API never sets it from an agent context.
- `POST /v1/applications/:id/followups` → schedule follow-up (Green internal reminder).

### Interview prep & skills
- `POST /v1/prep` `{ applicationId }` → generate questions + evidence map (Green).
- `POST /v1/prep/:id/mock` → start mock session; `POST /v1/prep/:id/mock/:sid/answer` → submit answer, get feedback.
- `GET /v1/skills/gaps` · `GET /v1/skills/learning` · `PATCH /v1/skills/learning/:id` (progress).

### Drafts (cover/outreach) — Yellow at send
- `POST /v1/drafts` `{ type, opportunityId }` → generate draft (Green).
- `POST /v1/drafts/:id/send` → **Yellow**, requires approval token; only via user-connected channel where ToS permits; otherwise returns `capability_denied` with guidance to send manually.

### Portfolio — Yellow at publish, private by default
- `POST /v1/portfolio` → generate/update the portfolio draft (Green; zero-fabrication — every rendered item resolves to a real profile fact/project/graph node; stays private).
- `GET /v1/portfolio` → owner view (Green; draft + publish state).
- `POST /v1/portfolio/publish` → **Yellow**, requires approval token; freezes the current draft into the public snapshot; audited.
- `GET /v1/portfolio/public/:slug` → public read (no auth); serves ONLY the frozen snapshot of `status='published'` portfolios — an unpublished portfolio is never publicly readable (404).

### Briefing & automation
- `POST /v1/briefings/run` `{ trigger: "manual" }` → enqueue loop → `{ briefingRunId }`.
- `GET /v1/briefings/:id` → run status, steps (with trace ids + cost), items.
- `GET /v1/briefings/latest` → today's briefing for Home.
- `POST /v1/briefings/:id/items/:itemId/approve|edit|skip` → act on a proposed item; `approve` on a Yellow item mints/consumes an `ApprovalToken`.
- `GET /v1/audit` → immutable audit log (who/what/when/why/model) for the user.

### Connectors
- `GET /v1/sources` → allow-listed sources + connection status.
- `POST /v1/sources/:key/connect` → begin OAuth (user-source); `DELETE /v1/sources/:key` → revoke.

### Career Intelligence Engine (PRD Amendment A1) — all Green/advisory
- `GET /v1/cie/state` → Career State Model: dimensions with value, **confidence**, provenance, freshness.
- `GET /v1/cie/state/:dimension/explain` → evidence + reasoning for one dimension.
- `POST /v1/cie/state/recompute` → enqueue incremental state update (Green).
- `GET /v1/cie/graph?node=&depth=&types=` → subgraph (nodes+edges) around a node for exploration/reasoning.
- `POST /v1/cie/decide` `{ question, context? }` → decision-support run → returns the structured contract `{ alternatives, evidence, reasoning, confidence, assumptions, recommendation, optionalityNote }`. Advisory only.
- `POST /v1/cie/decide/offers` `{ offerIds[] }` → objective multi-factor offer comparison weighted by the user's values/goals.
- `GET|POST /v1/cie/plans` → list/generate plans; `GET /v1/cie/plans/:horizon` (d30|d90|y1|y3|y5) → active plan with objectives, actions, rationale, diff-from-prior.
- `POST /v1/cie/plans/:horizon/regenerate` → force adaptive regeneration (also auto-triggered on material change).
- `PATCH /v1/cie/plans/actions/:id` → update action status/progress (feeds adherence metrics).
- `GET /v1/cie/dashboards` → all intelligence metrics with value, trend, **explanation ("why it matters")**, and linked plan action.
- `GET /v1/cie/dashboards/:metric` → drill-down to evidence.
- `GET /v1/cie/research?domain=` → synthesized, personalized research findings (cited); `GET /v1/cie/research/feed` → recent findings affecting this user.
- `GET /v1/cie/recommendations` → open strategic recommendations; `PATCH /v1/cie/recommendations/:id` → record decision (accepted|rejected|deferred) → later correlated to outcome for calibration.

> **Autonomy note:** every CIE endpoint is advisory (Green). Any *action* arising from a recommendation (apply, send, accept) goes through the existing Yellow/Red routes and the capability-gate. The CIE never acts; it advises with evidence + confidence.

### Twin (realtime)
- `WS /rt/twin` → bidirectional chat; server streams tokens + tool-call events; every turn assembles min-slice memory and logs to audit. Heavy steps dispatched to workers; the socket streams progress.
- Event types: `token`, `tool_call`, `tool_result`, `approval_required` (Yellow), `done`, `error`.

## 5. Rate limiting & abuse

Per-user + per-source rate limits in Redis. Connector calls obey each `SourceRegistry.rate_policy`. LLM calls carry per-user budget checks; exceeding free-tier budget → `rate_limited` with upgrade path.

## 6. Contract testing

`packages/contracts` zod schemas generate types for both sides; contract tests assert server responses validate against schemas. Breaking a schema fails CI. WS event payloads are equally schema-validated.
