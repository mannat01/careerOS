// Root Vitest workspace: any package that ships a vitest.config.ts is picked up
// by `pnpm -w test`. Per-package configs stay authoritative.
export default [
  'packages/*/vitest.config.ts',
  'packages/cie/*/vitest.config.ts',
  'apps/*/vitest.config.ts',
  'evals/vitest.config.ts',
];
