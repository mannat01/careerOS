# Milestone 01 — Foundations

**PRD phase:** Phase 0 · **Complexity:** L (≈2–3 eng-weeks) · **Depends on:** none
**Demo path:** a signed-in user; one real job appears in the DB fetched from a sanctioned source; an attempt to run a Yellow action without approval is blocked and audited.

---

## Objectives
Stand up the skeleton every later milestone builds on: monorepo, environments, managed auth, the core data model, observability + immutable audit, the capability-gate (autonomy boundary) as real code, and **one sanctioned source integrated end-to-end**. Prove the invariants (PRD §5 of master-plan) are enforced from day one.

## Dependencies
None. This milestone unblocks all others.

## Deliverables
- Turborepo/pnpm monorepo with `apps/web|api|workers` and `packages/*` per `project-structure.md`, CI pipeline (typecheck, lint, test, migrate) and preview envs.
- Managed auth wired (SSO/passkeys/MFA available); `GET /v1/me`, `PATCH /v1/me/settings`; per-user request scoping.
- Prisma schema for the **core** entities: `User`, `UserSettings`, `Profile`, `Experience`, `Project`, `Education`, `SkillClaim`, `Opportunity`, `SourceRegistry`, `AuditLog`, `ApprovalToken` (others stubbed as later milestones need them).
- `packages/observability`: OTel tracing + structured logging + audit client; traces visible in Langfuse/OTel backend.
- `packages/capability-gate`: tier registry (Green/Yellow/Red), token mint/verify, NestJS interceptor + worker wrapper.
- `packages/connectors`: `SourceConnector` interface + `SourceRegistry` allow-list + **one** adapter (Greenhouse or Lever public API — no-auth) → normalize → dedup → persist `Opportunity`. Ingestion worker + BullMQ wiring.
- `packages/llm-gateway` skeleton (provider client, tier param, cost-metering hook) — no product prompts yet.
- Data-lifecycle scaffolding: `POST /v1/me/export` (enqueues) and `DELETE /v1/me` (hard delete cascade) working end-to-end.
- `infra/` Terraform for DB, Redis, object storage, deploy target.

## Acceptance criteria
- A user can sign up/in; `GET /v1/me` returns user + conservative default `UserSettings` (autonomy defaults conservative).
- Running the ingestion worker fetches from the one live source and persists ≥1 deduped `Opportunity`; a second run does not create duplicates.
- A request to a Yellow-tagged action **without** a valid `ApprovalToken` returns `capability_denied` and writes an `AuditLog` entry; a Red action has no callable route.
- A fetch to a host **not** in `SourceRegistry` is rejected with `source_not_allowed`.
- Every agent/ingestion step emits an OTel span tied to an `AuditLog`/run id.
- Hard delete removes all of a test user's owned rows + artifacts; export produces a complete archive.

## Testing requirements
- Unit: capability-gate token mint/verify; dedup key logic; env schema.
- Integration: auth scope (user A cannot read user B); ingestion persistence + dedup.
- **Security tests (required):** Yellow/Red blocked without/with-invalid token; non-allow-listed source blocked. These run in CI from now on.
- E2E: sign-in → see an opportunity.
- Infra smoke: migrate up/down clean.

## Estimated complexity
L. Highest-risk items: capability-gate design (get the interceptor + token binding right) and the connector framework (make the allow-list truly enforced at the fetch layer).

## Files/modules expected to change (create)
`apps/api/{main,app.module}`, `apps/api/common/{auth,capability-gate,errors,audit}`, `apps/api/modules/identity`, `apps/api/jobs`, `apps/workers/{ingestion,consumers}`, `packages/db`, `packages/contracts`, `packages/capability-gate`, `packages/connectors`, `packages/observability`, `packages/llm-gateway`, `packages/config`, `infra/*`, root CI config.
