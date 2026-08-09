import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * apps/web vitest config.
 *
 * The Trust Kit (`src/trust/`) is React + JSX, so tests need:
 *   - `@vitejs/plugin-react` to transform TSX (esbuild alone does JSX but
 *      the React plugin also handles the automatic runtime).
 *   - `jsdom` environment for DOM APIs (`document`, `window`, `getBoundingClientRect`).
 *   - `vitest-axe` matchers registered via `src/test/setup.ts`.
 *
 * Non-DOM tests (src/api/**) still work under jsdom — the extra APIs are
 * inert to Node-only code.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'app/**/*.test.ts', 'app/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
  },
});