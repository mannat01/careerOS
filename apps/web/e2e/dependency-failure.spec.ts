import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('dev@careeros.local');
  await Promise.all([
    page.waitForURL('**/today'),
    page.getByRole('button', { name: 'Continue' }).click(),
  ]);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
}

test('real identity dependency failure renders recovery without an auth/onboarding redirect', async ({ page }) => {
  test.setTimeout(45_000);
  await signIn(page);

  const postgres = postgresContainerId();
  try {
    execFileSync('docker', ['stop', '--time', '0', postgres], { stdio: 'pipe' });
    await page.goto('/plan');
    await expect(page.getByTestId('routing-recovery')).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/plan$/);
    await expect(page).not.toHaveURL(/\/(sign-in|onboarding)$/);
  } finally {
    execFileSync('docker', ['start', postgres], { stdio: 'pipe' });
    waitForHealthy(postgres);
  }
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

function waitForHealthy(container: string): void {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = execFileSync(
      'docker',
      ['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', container],
      { encoding: 'utf8' },
    ).trim();
    if (status === 'healthy') return;
    execFileSync('sleep', ['1']);
  }
  throw new Error('Postgres did not become healthy after dependency-failure test.');
}