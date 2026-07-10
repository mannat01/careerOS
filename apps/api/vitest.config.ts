
import { defineConfig } from 'vitest/config';

// Unit tests only — e2e (needs DB+Redis) lives in vitest.integration.config.ts.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], exclude: ['test/**/*.e2e.test.ts', '**/node_modules/**'] },
});
