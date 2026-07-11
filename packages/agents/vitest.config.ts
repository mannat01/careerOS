// Skill-agent evals are deterministic (FakeLlmProvider) and DB-free, so they
// run inside `pnpm -w test` alongside unit tests (coding-standards: changing a
// prompt requires its agent.eval.ts to pass).
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.eval.ts', 'test/**/*.test.ts'] } });
