// EVAL GATE — scores the current agents against the golden datasets.
// Deliberately excluded from `pnpm -w test` (separate config, only run via
// `pnpm --filter @careeros/evals eval`). RED until the real M02 extractor +
// state-updater land (Step 2): the stub agents score 0.
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['eval/**/*.eval.ts'] } });
