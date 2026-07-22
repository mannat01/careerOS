// GapAnalyzer integrity suite is deterministic and DB-free, so it runs inside
// `pnpm -w test` alongside unit tests.
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });