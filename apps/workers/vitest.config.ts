import { defineConfig } from 'vitest/config';

// Unit tests for the workers app. The scheduler + overnight loop are pure
// orchestration seams around narrow ports; the real BullMQ/Redis wiring is
// exercised by apps/api integration tests (Postgres + Redis in Docker).
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });