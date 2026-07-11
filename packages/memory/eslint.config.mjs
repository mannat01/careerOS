import { base, agentBoundary } from '@careeros/config/eslint.preset.mjs';

// packages/memory is the single sanctioned path to user memory. It owns the memory
// tables' store INTERFACES, but must not import @careeros/db directly from the
// pure/core code — the Prisma-backed implementations live in @careeros/db behind
// these interfaces (same inversion as identity/profile). The agentBoundary overlay
// keeps that DB ban enforced in lint.
export default [
  ...base,
  agentBoundary,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
];
