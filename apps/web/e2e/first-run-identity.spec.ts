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
      await expect(page.getByRole('heading', { name: 'Bring in your résumé' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Bring in your résumé' })).toBeVisible();
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

test('full first run: import → review → correct → autonomy → complete → Today', async ({ page }) => {
  const email = `fm23-${Date.now()}@playwright.careeros.local`;
  const exactQuote = 'Skills: TypeScript';

  // The configured fake LLM deliberately yields thin extraction. Keep the whole
  // browser journey fake-backed while sending a deterministic, contract-valid
  // parsed extraction through the REAL import endpoint and real Postgres path.
  await page.route('**/v1/profile/import', async (route) => {
    const request = route.request();
    const response = await route.fetch({
      postData: JSON.stringify({
        entities: [{
          kind: 'skill',
          name: 'TypeScript',
          evidence: 'claimed',
          provenance: { source: 'resume', quote: exactQuote },
        }],
      }),
      headers: { ...request.headers(), 'content-type': 'application/json' },
    });
    await route.fulfill({ response });
  });

  await signIn(page, email, '/onboarding');
  await page.getByLabel('Résumé text').fill(exactQuote);
  const importResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/v1/profile/import' && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Extract résumé' }).click();
  expect((await importResponse).status()).toBe(200);

  await expect(page.getByRole('heading', { name: 'Review your extracted résumé' })).toBeVisible();
  await expect(page.getByText(exactQuote)).toBeVisible();
  await page.getByRole('button', { name: 'Review what CareerOS understands' }).click();

  await expect(page.getByRole('heading', { name: 'What CareerOS understands about you' })).toBeVisible();
  await expect(page.getByText('Not enough signal yet').first()).toBeVisible();
  await page.getByRole('button', { name: 'Correct source fact: TypeScript' }).click();
  const correction = page.getByRole('textbox', { name: 'Corrected skill fact' });
  await correction.fill('PostgreSQL');
  const editResponse = page.waitForResponse((response) =>
    response.url().includes('/v1/profile/facts/') && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save correction' }).click();
  expect((await editResponse).status()).toBe(200);
  await expect(page.getByTestId('authoritative-corrections').getByText('PostgreSQL')).toBeVisible();
  await expect(page.getByTestId('authoritative-corrections').getByText('You added')).toBeVisible();

  await page.getByRole('button', { name: 'Review autonomy defaults' }).click();
  await expect(page.getByRole('heading', { name: "How CareerOS will and won't act for you" })).toBeVisible();
  await expect(page.getByLabel('Tier: Auto')).toBeVisible();
  await expect(page.getByLabel('Tier: Needs your OK').first()).toBeVisible();
  await expect(page.getByLabel('Tier: Never automatic')).toBeVisible();

  const settingsResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/v1/me/settings' && response.request().method() === 'PATCH',
  );
  await page.getByLabel('Make this more restrictive').first().selectOption('yellow');
  expect((await settingsResponse).status()).toBe(200);
  await expect(page.getByTestId('autonomy-actions').getByLabel('Tier: Needs your OK'))
    .toHaveCount(3);

  const completionResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/v1/me/onboarding/complete' && response.request().method() === 'POST',
  );
  await Promise.all([
    page.waitForURL('**/today'),
    page.getByRole('button', { name: 'This looks right — start using CareerOS' }).click(),
  ]);
  expect((await completionResponse).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();

  await page.goto('/onboarding');
  await expect(page).toHaveURL(/\/today$/);
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