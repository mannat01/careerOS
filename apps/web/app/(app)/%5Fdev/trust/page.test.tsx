import { axe } from 'vitest-axe';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetApiClientForTests } from '@/api';
import { _resetWebEnvCacheForTests, _resetWebServerEnvCacheForTests } from '@/config/env';
import { AppShell } from '@/shell';
import { assertTrustKitEnabled, default as TrustPage, isTrustKitEnabled } from './page';

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => ({ value: 'test-session-token' }) }),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
  usePathname: () => '/_dev/trust',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const now = '2026-01-06T06:00:00.000Z';
const dimensions = ['career_goals', 'interests', 'strengths', 'weaknesses', 'demonstrated_skills', 'inferred_skills', 'learning_velocity', 'preferred_industries', 'preferred_company_sizes', 'compensation_goals', 'geographic_preferences', 'work_style_preferences', 'values', 'leadership_readiness', 'communication_style'] as const;
const liveBodies: Record<string, unknown> = {
  '/v1/me': { user: { id: '00000000-0000-4000-8000-000000000001', email: 'dev@careeros.local', authProviderId: 'dev-user', subscriptionTier: 'pro', status: 'active', createdAt: now, updatedAt: now }, settings: { userId: '00000000-0000-4000-8000-000000000001', autonomyDefaults: { 'briefing.item.execute': 'yellow' }, quietHours: null, briefingSchedule: null, sourcePrefs: {}, dataUseOptIns: { training: false, crossUserIntel: false }, createdAt: now, updatedAt: now } },
  '/v1/cie/state': { profileId: '00000000-0000-4000-8000-000000000001', version: 1, updatedAt: now, dimensions: dimensions.map((dimension) => ({ dimension, value: { values: [] }, confidence: 0, provenance: 'no-signal', evidenceRefs: [], freshnessAt: now, modelVersion: 'state-v1' })) },
  '/v1/opportunities': { data: [{ id: 'opportunity-1', source: 'dev', sourceRef: 'dev-1', company: 'Helios Labs', role: 'Staff Backend Engineer', comp: null, location: 'Remote', remote: true, ingestedAt: now }], nextCursor: null },
  '/v1/opportunities/opportunity-1/match': { opportunityId: 'opportunity-1', overall: 87, subscores: [{ key: 'skills', value: 90 }], explanation: 'Strong overlap from seeded evidence.', evidenceRefs: ['experience:1'], modelVersion: 'match-v1' },
  '/v1/audit': { data: [{ id: 'audit-1', userId: '00000000-0000-4000-8000-000000000001', actor: 'twin', action: 'opportunity.score', target: null, reason: 'Grounded score.', modelVersion: 'match-v1', traceId: null, at: now }], nextBefore: null },
  '/v1/briefings/latest': { id: 'briefing-1', userId: '00000000-0000-4000-8000-000000000001', trigger: 'scheduled', status: 'complete', inputs: {}, steps: [], costTotal: 0, startedAt: now, finishedAt: now, items: [{ id: 'item-1', kind: 'draft', refId: 'opportunity-1', autonomyTier: 'yellow', state: 'proposed', payload: { title: 'Outreach draft', summary: 'Review before sending.' }, createdAt: now }] },
};

function mockLiveApi(): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const path = input instanceof Request ? new URL(input.url).pathname : new URL(input.toString()).pathname;
    calls.push(path);
    const body = liveBodies[path];
    return body === undefined ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return { calls };
}

async function renderLoadedTrustKit(): Promise<{ calls: string[]; container: HTMLElement }> {
  const transport = mockLiveApi();
  const rendered = render(await TrustPage());
  await screen.findByRole('heading', { name: 'Populated opportunity match' });
  return { ...transport, container: rendered.container };
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:3001');
  vi.stubEnv('NEXT_PUBLIC_AUTH_PROVIDER', 'dev');
  vi.stubEnv('AUTH_PROVIDER', 'dev');
  vi.stubEnv('DEV_AUTH_SECRET', 'test-only-secret');
  vi.stubEnv('NODE_ENV', 'test');
  _resetApiClientForTests(); _resetWebEnvCacheForTests(); _resetWebServerEnvCacheForTests();
});

afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  _resetApiClientForTests(); _resetWebEnvCacheForTests(); _resetWebServerEnvCacheForTests();
});

describe('/_dev/trust', () => {
  it('returns not-found in production before fetching', async () => {
    expect(isTrustKitEnabled('production')).toBe(false);
    expect(isTrustKitEnabled('development')).toBe(true);
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    vi.stubEnv('NODE_ENV', 'production'); _resetWebServerEnvCacheForTests();
    expect(() => assertTrustKitEnabled()).toThrow('NEXT_NOT_FOUND');
    await expect(TrustPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders all four sections from shared-schema live responses', async () => {
    const { calls } = await renderLoadedTrustKit();
    expect(screen.getByRole('region', { name: 'Trust Kit kitchen sink' })).toBeInTheDocument();
    for (const heading of ['CIE state', 'Populated opportunity match', 'Audit evidence', 'Seeded Yellow briefing item']) expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(calls).toEqual(expect.arrayContaining(['/v1/me', '/v1/cie/state', '/v1/opportunities', '/v1/opportunities/opportunity-1/match', '/v1/audit', '/v1/briefings/latest']));
  });

  it('uses the single main landmark owned by AppShell', async () => {
    mockLiveApi();
    render(<AppShell>{await TrustPage()}</AppShell>);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Trust Kit kitchen sink' })).toBeInTheDocument();
  });

  it('renders no-signal without a fabricated numeric score', async () => {
    await renderLoadedTrustKit();
    const regions = screen.getAllByTestId('insufficient-data');
    expect(regions).toHaveLength(15);
    expect(screen.getAllByTestId('provenance-tag')).toHaveLength(15);
    for (const region of regions) expect(region.textContent ?? '').not.toMatch(/\b\d+(?:\.\d+)?%?\b/);
    expect(screen.getAllByTestId('confidence-value')).toHaveLength(1);
  });

  it('leaves Yellow proposed and does not mint on load', async () => {
    const { calls } = await renderLoadedTrustKit();
    expect(screen.getByText('State: proposed')).toBeInTheDocument();
    expect(screen.queryByTestId('approval-dialog')).not.toBeInTheDocument();
    expect(calls).not.toContain('/v1/briefings/briefing-1/items/item-1/approve');
  });

  it('is axe-clean and keyboard navigation reaches Trust Kit controls', async () => {
    const { container } = await renderLoadedTrustKit();
    expect(await axe(container)).toHaveNoViolations();
    const user = userEvent.setup(); const review = screen.getByRole('button', { name: 'Review approval' });
    for (let index = 0; index < 80; index += 1) { await user.tab(); if (document.activeElement === review) return; }
    throw new Error('Keyboard navigation did not reach Review approval');
  });
});