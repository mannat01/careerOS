// Dataset-integrity + harness unit tests — DB-free, part of `pnpm -w test`.
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
