// On-demand, paid, non-deterministic campaign. Deliberately separate from
// vitest.eval-ci.config.ts and never part of the blocking GREEN_EVAL_SUITES.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['real/extraction.real.ts', 'real/tailoring.real.ts', 'real/scoring.real.ts', 'real/decision.real.ts'],
    testTimeout: 1_200_000,
    hookTimeout: 1_200_000,
    maxConcurrency: 1,
    fileParallelism: false,
  },
});