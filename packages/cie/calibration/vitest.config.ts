// Calibration analysis is deterministic and DB-free — its integrity suite runs
// inside `pnpm -w test` alongside unit tests.
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });