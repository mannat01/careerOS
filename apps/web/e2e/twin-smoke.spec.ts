import { expect, test, type Page, type Response } from '@playwright/test';

async function signIn(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('dev@careeros.local');
  await Promise.all([
    page.waitForURL('**/today'),
    page.getByRole('button', { name: 'Continue' }).click(),
  ]);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
}

async function submitTwinTurn(page: Page, prompt: string): Promise<Response> {
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/rt/twin') && response.request().method() === 'POST',
  );
  await page.getByLabel('Question').fill(prompt);
  await page.getByRole('button', { name: 'Ask Twin' }).click();
  return responsePromise;
}

test('real local API/web Twin smoke: strategic completion then Yellow halt', async ({ page }) => {
  const browserMutations: string[] = [];
  page.on('request', (request) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method())) browserMutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });

  await signIn(page);
  const shellUrl = page.url();
  let navigationsAfterShell = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigationsAfterShell += 1;
  });

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await expect(page.getByRole('dialog', { name: 'Twin' })).toBeVisible();

  const strategicResponse = await submitTwinTurn(page, 'Should I apply to a staff backend role now?');
  await expect(page.getByTestId('twin-status')).toHaveText('complete');
  const strategicTypes = await page.locator('[data-event-type]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-event-type')));
  expect(strategicTypes[0]).toBe('context');
  expect(strategicTypes).toContain('tool_call');
  expect(strategicTypes).toContain('tool_result');
  expect(strategicTypes).toContain('token');
  expect(strategicTypes.at(-1)).toBe('done');
  expect(strategicResponse.status()).toBe(200);
  expect(strategicResponse.headers()['content-type']).toContain('text/event-stream');
  expect(await strategicResponse.text()).toContain('event: tool_call');
  await expect(page.getByTestId('twin-answer')).not.toBeEmpty();

  const yellowResponse = await submitTwinTurn(page, 'Please send this outreach email to the recruiter now.');
  await expect(page.getByTestId('twin-status')).toHaveText('approval required');
  await expect(page.getByTestId('twin-approval-required')).toBeVisible();
  const yellowTypes = await page.locator('[data-event-type]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-event-type')));
  expect(yellowTypes).toEqual(['approval_required']);
  expect(yellowTypes).not.toContain('token');
  expect(yellowTypes).not.toContain('tool_call');
  expect(yellowResponse.status()).toBe(200);
  const yellowWire = await yellowResponse.text();
  expect(yellowWire).toContain('event: approval_required');
  expect(yellowWire).not.toContain('event: token');
  expect(yellowWire).not.toContain('event: tool_call');

  expect(page.url()).toBe(shellUrl);
  expect(navigationsAfterShell).toBe(0);
  const afterSignInMutations = browserMutations.filter((entry) => !entry.includes('/sign-in'));
  expect(afterSignInMutations.every((entry) => entry === 'POST /rt/twin' || entry === 'POST /api/auth/token')).toBe(true);
  expect(afterSignInMutations.filter((entry) => entry === 'POST /rt/twin')).toHaveLength(2);
});