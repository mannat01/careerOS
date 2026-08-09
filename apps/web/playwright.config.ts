import { defineConfig, devices } from '@playwright/test';

const root = '../..';
const loadLocalEnv = 'if [ -f .env ]; then set -a; . ./.env; set +a; fi;';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `cd ${root} && ${loadLocalEnv} AUTH_PROVIDER=dev LLM_PROVIDER=fake PORT=3001 pnpm --filter @careeros/api dev`,
      url: 'http://127.0.0.1:3001/healthz',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `cd ${root} && ${loadLocalEnv} NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001 NEXT_PUBLIC_AUTH_PROVIDER=dev AUTH_PROVIDER=dev pnpm --filter @careeros/web dev`,
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});