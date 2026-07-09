# CareerOS — AI-native Career Operating System

Monorepo scaffold. **Source of truth is `/docs` and `CLAUDE.md`.** Build one milestone at a time.

## Start here
1. `CLAUDE.md` — how to work in this repo (read every session).
2. `docs/master-plan.md` — stack, glossary, milestone index, execution protocol.
3. `docs/milestone-01.md` + `docs/milestone-01-workorder.md` — the current work order.

## Layout
- `apps/web` (Next.js), `apps/api` (NestJS monolith), `apps/workers` (agents/ingestion/scheduler/research)
- `packages/*` — db, contracts, llm-gateway, agents, cie/*, memory(+graph), connectors, capability-gate, ui, config, observability
- `evals/` — golden datasets + eval suites · `infra/` — Terraform + Docker · `docs/` — specs

## Invariants (enforced in code — see CLAUDE.md §3)
Autonomy boundary · human-in-loop at consequence · sanctioned sources only · zero fabrication · audit + provenance · min-slice/tiered models · privacy.

## Commands
`pnpm install` · `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm eval` · `pnpm migrate`
