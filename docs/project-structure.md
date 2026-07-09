# CareerOS — Project Structure

**Derived from:** PRD §13, `architecture.md`. Turborepo + pnpm monorepo. Module names here are canonical and referenced by every milestone's "Files/modules expected to change."

---

## 1. Monorepo layout

```
careeros/
├─ apps/
│  ├─ web/                    # Next.js App Router (PWA)
│  ├─ api/                    # NestJS modular monolith (BFF + core domain)
│  └─ workers/               # NestJS standalone: agents, ingestion, scheduler
├─ packages/
│  ├─ db/                    # Prisma schema, migrations, generated client
│  ├─ contracts/            # Shared zod schemas + TS types (API DTOs, tool I/O)
│  ├─ llm-gateway/          # Multi-provider client, routing, cost metering
│  ├─ agents/               # Orchestrator + skill-agents + tool registry
│  ├─ cie/                  # Career Intelligence Engine: state/, reasoning/, planner/, metrics/
│  ├─ memory/               # MemoryService + graph/ (GraphMemoryService)
│  ├─ connectors/           # SourceConnector interface + sanctioned adapters
│  ├─ capability-gate/      # Autonomy-tier enforcement middleware + tokens
│  ├─ ui/                   # shadcn-based component library (design system)
│  ├─ config/              # eslint, tsconfig, tailwind preset, env schema
│  └─ observability/       # OTel setup, logger, audit client
├─ evals/                   # Promptfoo/Langfuse eval suites per skill-agent
├─ infra/                   # Terraform, Dockerfiles, k8s/PaaS manifests
├─ docs/                    # This documentation set
├─ turbo.json
├─ pnpm-workspace.yaml
└─ package.json
```

## 2. Package boundaries (import rules)

- `apps/web` imports `contracts`, `ui`, `config`. **Never** imports `db`, `agents`, `connectors`, or `memory` directly.
- `apps/api` imports `db`, `contracts`, `capability-gate`, `observability`, and core domain modules; enqueues to workers.
- `apps/workers` imports `agents`, `memory`, `connectors`, `llm-gateway`, `db`, `capability-gate`, `observability`.
- `agents` imports `memory`, `llm-gateway`, `capability-gate`, `contracts`. **Never** touches `db` directly — memory/domain access only through services.
- `memory` is the only package that reads/writes memory tables. `connectors` is the only package that talks to external sources.
- Cyclic deps are a lint error. Cross-domain reads go through the owning module's service interface, never its tables.

## 3. Internal module map (`apps/api`)

```
apps/api/src/
├─ main.ts
├─ app.module.ts
├─ common/                  # guards, interceptors, filters, pipes
│  ├─ auth/                 # authN/Z guard (managed provider), user scope
│  ├─ capability-gate/      # sync gate interceptor for side-effecting routes
│  ├─ errors/               # error model + exception filter
│  └─ audit/                # audit interceptor
├─ modules/
│  ├─ identity/             # User, Profile, Experience, Project, Education, SkillClaim
│  ├─ resume/               # ResumeModel, ResumeVariant, render orchestration
│  ├─ opportunity/          # Opportunity, MatchScore
│  ├─ application/          # Application, follow-ups
│  ├─ prep/                 # InterviewPrep, MockSession, SkillGap, LearningItem
│  ├─ briefing/             # BriefingRun API, approval queue
│  └─ analytics/            # funnel metrics, market positioning
└─ jobs/                    # BullMQ producers (enqueue agent/ingestion work)
```

## 4. Workers map (`apps/workers`)

```
apps/workers/src/
├─ scheduler/               # cron → enqueue daily briefing + research/plan-maintenance (quiet hours)
├─ orchestrator/            # plans + runs briefing loop / chat / decision / continuous runs
├─ skill-agents/            # discoverer, scorer, tailor, gap, drafter, interviewer, debriefer, composer,
│                           #   state-updater, strategic-reasoner, planner, metric-composer
├─ research/                # autonomous research agents (trends/salary/skills/tech/certs/company/industry)
├─ ingestion/               # per-source fetch → normalize → dedup → embed → graph upsert
└─ consumers/               # BullMQ queue bindings
```

## 5. Naming conventions

- Files: `kebab-case.ts`. React components: `PascalCase.tsx`. Types/interfaces: `PascalCase`. Zod schemas: `xxxSchema`. DB tables: `snake_case`; Prisma models `PascalCase`.
- One skill-agent per folder with `agent.ts`, `prompt.ts`, `io.ts` (zod I/O), `agent.eval.ts`.
- API routes: `/v1/<resource>` REST; realtime namespace `/rt`.
- Env vars validated by a single zod schema in `packages/config`; no `process.env` access outside it.

## 6. Where things live (quick index)

| Concern | Location |
|---|---|
| DB schema & migrations | `packages/db` (see `database-schema.md`) |
| API DTOs / shared types | `packages/contracts` (see `api-spec.md`) |
| Autonomy enforcement | `packages/capability-gate` + `apps/api/common/capability-gate` |
| Memory tiers | `packages/memory` |
| Source allow-list | `packages/connectors` |
| Skill-agents | `packages/agents` + `apps/workers/skill-agents` |
| UI components | `packages/ui` (see `component-library.md`) |
| Design tokens | `packages/ui/tokens` + `packages/config/tailwind` (see `design-system.md`) |
| Evals | `evals/` |
