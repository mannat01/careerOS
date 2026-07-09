// CareerOS shared ESLint preset (flat config).
// Base preset applies to ALL packages. Boundary OVERLAYS are opted into only by the
// packages they constrain, because a global @careeros/db ban would wrongly block
// apps/api + apps/workers, which legitimately depend on it (project-structure.md §2).
//
// Usage:
//   // most packages:
//   import { base } from '@careeros/config/eslint.preset.mjs';
//   export default base;
//
//   // packages/agents, packages/cie/*:
//   import { base, agentBoundary } from '@careeros/config/eslint.preset.mjs';
//   export default [...base, agentBoundary];
//
//   // apps/web:
//   import { base, webBoundary } from '@careeros/config/eslint.preset.mjs';
//   export default [...base, webBoundary];
//
//   // packages/config only (may read process.env): import { base, allowEnv }.
import tseslint from 'typescript-eslint';

export const base = tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/*.config.*'] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // No process.env outside packages/config (overridden by `allowEnv` there).
      'no-restricted-properties': ['error',
        { object: 'process', property: 'env',
          message: 'Read env only via @careeros/config loadEnv() — no process.env elsewhere.' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);

// Overlay: agents/reasoning/cie must not import the DB directly — go through memory/domain services.
export const agentBoundary = {
  files: ['**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', { patterns: [
      { group: ['@careeros/db', '@careeros/db/*'],
        message: 'agents/cie must not import @careeros/db — use @careeros/memory or a domain service (project-structure.md §2).' },
    ]}],
  },
};

// Overlay: apps/web may only import contracts/ui/config.
export const webBoundary = {
  files: ['**/*.ts', '**/*.tsx'],
  rules: {
    'no-restricted-imports': ['error', { patterns: [
      { group: ['@careeros/db*', '@careeros/agents*', '@careeros/memory*', '@careeros/connectors*',
                '@careeros/capability-gate*', '@careeros/llm-gateway*', '@careeros/cie*'],
        message: 'apps/web may only import @careeros/contracts, @careeros/ui, @careeros/config.' },
    ]}],
  },
};

// Overlay: only packages/config may read process.env.
export const allowEnv = {
  files: ['**/*.ts'],
  rules: { 'no-restricted-properties': 'off' },
};

export default base;
