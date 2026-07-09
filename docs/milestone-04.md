# Milestone 04 — Discovery, Pipeline & Graph Ingestion

**PRD ref:** Phase 1 + A1.2 · **Complexity:** L (≈2–3 eng-weeks) · **Depends on:** M01, M02
**Demo path:** discovered opportunities from 2–3 sanctioned sources appear scored + explained; the user tracks them through a pipeline; each opportunity, company, and required skill lands in the career graph.

---

## Objectives
Fill the opportunity layer: multi-source ingestion into a canonical, deduped `Opportunity`; scored + explained matches; an application pipeline (CRM). Per A1.2, ingestion also **upserts opportunities, companies, and required skills into the career graph** so the CIE can later reason about how opportunities relate to the user's skills and goals.

## Dependencies
M01 (connector framework, one source), M02 (profile/state/graph for scoring + graph upsert).

## Deliverables
- 2–3 sanctioned `SourceConnector` adapters (e.g., Greenhouse + Lever public APIs + one licensed aggregator or USAJobs), each with rate policy + normalization mapping. Ingestion workers: fetch → normalize → dedup → embed → **graph upsert**.
- `Opportunity` list/detail APIs with filters (source, remote, comp, freshness); sanitized `raw_payload` (prompt-injection defense on ingested text).
- Match scoring at discovery time (reuse M03 `Scorer`); `MatchScore` per opportunity.
- `Application` pipeline: create/track, status enum, timeline, follow-ups. **`applied` set only by explicit user action.**
- Web: `OpportunityCard` (score + source badge), opportunity detail, `PipelineBoard` (Kanban), follow-up scheduling.

## Acceptance criteria
- Ingesting from ≥2 sources persists deduped opportunities; a non-allow-listed host is blocked (`source_not_allowed`).
- Each opportunity shows a `MatchScore` with subscores + explanation; ingested text is sanitized (injection test passes).
- Discovery upserts graph nodes/edges: opportunity→company, opportunity→required-skill, and links to the user's matching skill nodes; visible in the graph explorer.
- Moving an application across the pipeline persists optimistically; transitioning to `applied` requires the explicit user-action flag and is audited.

## Testing requirements
- Unit: per-source normalization mappers; dedup; rate-policy enforcement; graph upsert idempotency.
- Integration: multi-source ingest → dedup → score → graph; pipeline transitions.
- **Security:** allow-list enforcement; prompt-injection sanitization of ingested job text.
- E2E: discover → view scored opportunity → track through pipeline.

## Estimated complexity
L. Risk: per-source normalization variety; dedup across sources; keeping ingested content untrusted end-to-end.

## Files/modules expected to change
`apps/api/modules/opportunity`, `apps/api/modules/application`, `apps/workers/ingestion` (adapters + graph upsert), `packages/connectors` (adapters, allow-list), `packages/memory/graph` (upsert API), `packages/db` (opportunity, application), `apps/web` (`OpportunityCard`, detail, `PipelineBoard`), `packages/ui`, `evals/scoring` (discovery-time).
