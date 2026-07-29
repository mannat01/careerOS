# @careeros/web

Next.js 14 App Router — the CareerOS user-facing web app.

## Scripts

- `pnpm --filter @careeros/web dev` — Next dev server on `:3000`.
- `pnpm --filter @careeros/web build` — production build.
- `pnpm --filter @careeros/web lint` — flat ESLint (base + webBoundary overlay).
- `pnpm --filter @careeros/web typecheck` — `tsc --noEmit`.
- `pnpm --filter @careeros/web test` — vitest (env parser + token guards).

## Boundaries

- **Env**: `src/config/env.ts` is the ONLY module allowed to read `process.env`.
  Everything else calls `loadWebEnv()`. Enforced by the base ESLint preset's
  `no-restricted-properties` rule.
- **Package imports**: `webBoundary` overlay bans `@careeros/db`,
  `@careeros/agents`, `@careeros/memory`, `@careeros/connectors`,
  `@careeros/capability-gate`, `@careeros/llm-gateway`, `@careeros/cie*`.
  The web app reaches server code ONLY via HTTP through `@careeros/contracts`.
- **Styling**: Tailwind classes must reference semantic tokens (`bg-bg-base`,
  `text-tier-yellow`, etc). Raw hex is banned in components.

## Route groups

- `app/(marketing)/` — public, unauthenticated (landing, `/p/[slug]` in FM5).
- `app/(auth)/` — sign-in / sign-up (FM1 task 6).
- `app/(app)/` — authenticated shell; rooms mount here (Today, Applications,
  Portfolio, Studio, Settings).

See `docs/frontend-architecture.md` §1–2 and
`docs/frontend-milestone-01-workorder.md`.