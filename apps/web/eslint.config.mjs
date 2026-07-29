import { base, webBoundary } from '@careeros/config/eslint.preset.mjs';

/**
 * apps/web ESLint — base preset + webBoundary overlay.
 *
 * The webBoundary overlay bans imports of `@careeros/db`, `@careeros/agents`,
 * `@careeros/memory`, `@careeros/connectors`, `@careeros/capability-gate`,
 * `@careeros/llm-gateway`, and `@careeros/cie*`. The web app may ONLY reach
 * server code via HTTP through `@careeros/contracts`. See project-structure
 * §2 + docs/frontend-architecture.md §1.
 *
 * The base preset also bans `process.env` outside the env boundary; we opt
 * `src/config/env.ts` out with a local `eslint-disable` comment, matching the
 * pattern used by `@careeros/config` on the server side.
 */
export default [
  ...base,
  webBoundary,
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
];