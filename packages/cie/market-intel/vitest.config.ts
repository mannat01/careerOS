// Cross-user market-intelligence aggregation is deterministic and DB-free — its
// privacy security suite (k-anonymity, opt-in gating, opt-out purge) runs inside
// `pnpm -w test` alongside unit tests.
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });