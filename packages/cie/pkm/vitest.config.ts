// PKM integrity suite is deterministic + DB-free, so it runs inside `pnpm -w test`.
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });