import { execFileSync } from 'node:child_process';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const API_BASE = 'http://127.0.0.1:3001';

async function signIn(page: Page, email: string, expectedPath: '/today' | '/onboarding'): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await Promise.all([
    page.waitForURL(`**${expectedPath}`),
    page.getByRole('button', { name: 'Continue' }).click(),
  ]);
}

async function bearerFromSession(page: Page): Promise<string> {
  const response = await page.request.post('/api/auth/token');
  expect(response.status()).toBe(200);
  const body = await response.json() as { token?: unknown };
  expect(typeof body.token).toBe('string');
  return body.token as string;
}

async function concurrentGuardedNavigation(context: BrowserContext): Promise<void> {
  const pages = await Promise.all([context.newPage(), context.newPage(), context.newPage()]);
  try {
    await Promise.all(pages.map((page) => page.goto('/today')));
    await Promise.all(pages.map(async (page) => {
      await expect(page).toHaveURL(/\/onboarding$/);
      await expect(page.getByRole('heading', { name: 'Finish setting up' })).toBeVisible();
    }));
  } finally {
    await Promise.all(pages.map((page) => page.close()));
  }
}

test('real first-run identity: bootstrap → onboarding; seeded user → Today', async ({ page, context }) => {
  const firstRunEmail = `first-run-${Date.now()}@playwright.careeros.local`;
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await signIn(page, firstRunEmail, '/onboarding');
  await expect(page.getByRole('heading', { name: 'Finish setting up' })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/onboarding$/);
  await concurrentGuardedNavigation(context);

  const token = await bearerFromSession(page);
  const me = await page.request.get(`${API_BASE}/v1/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(me.status()).toBe(200);
  const firstRunMe = await me.json() as { user?: { id?: unknown }; onboarding?: { status?: unknown } };
  expect(typeof firstRunMe.user?.id).toBe('string');
  expect(firstRunMe.onboarding?.status).toBe('required');
  expect(identityRowCounts(firstRunMe.user!.id as string)).toEqual({ users: 1, settings: 1 });
  expect(pageErrors).toEqual([]);

  await signIn(page, 'dev@careeros.local', '/today');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
});

function postgresContainerId(): string {
  const id = execFileSync(
    'docker',
    ['ps', '--filter', 'ancestor=pgvector/pgvector:pg16', '--format', '{{.ID}}'],
    { encoding: 'utf8' },
  ).trim().split('\n')[0];
  if (!id) throw new Error('Could not locate the existing pgvector Postgres dependency container.');
  return id;
}

function identityRowCounts(userId: string): { users: number; settings: number } {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Refusing to query a non-UUID identity.');
  const container = postgresContainerId();
  const environment = execFileSync('docker', ['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', container], { encoding: 'utf8' });
  const database = containerEnv(environment, 'POSTGRES_DB');
  const user = containerEnv(environment, 'POSTGRES_USER');
  const output = execFileSync('docker', [
    'exec', container, 'psql', '-U', user, '-d', database,
    '-At', '-F', '|', '-c',
    `SELECT (SELECT count(*) FROM users WHERE id = '${userId}'::uuid), (SELECT count(*) FROM user_settings WHERE user_id = '${userId}'::uuid);`,
  ], { encoding: 'utf8' }).trim();
  const [users, settings] = output.split('|').map(Number);
  return { users: users ?? 0, settings: settings ?? 0 };
}

function containerEnv(environment: string, key: string): string {
  const line = environment.split('\n').find((entry) => entry.startsWith(`${key}=`));
  if (!line) throw new Error(`Postgres container is missing ${key}.`);
  return line.slice(key.length + 1);
}