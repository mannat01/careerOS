import { describe, expect, it, vi } from 'vitest';
import { makeApiError } from '@careeros/contracts';
import { ApiError } from '../api/errors';
import { successFixtures } from '../test/msw/fixtures';
import { fetchBootstrapMe } from './onboarding';

describe('POST /v1/me/bootstrap server fetch', () => {
  it('uses POST with verified bearer only and parses the shared MeResponse contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response(
      JSON.stringify(successFixtures.me()),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    const me = await fetchBootstrapMe('server-token', {
      apiBaseUrl: 'https://api.example.test/',
      fetchImpl,
    });
    expect(me.onboarding.status).toBe('complete');
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/v1/me/bootstrap');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store' });
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer server-token');
    expect(init?.body).toBeUndefined();
  });

  it('preserves a genuine typed 401 for the refresh-once decision', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response(
      JSON.stringify(makeApiError('unauthenticated', 'expired')),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )));
    await expect(fetchBootstrapMe('expired', {
      apiBaseUrl: 'https://api.example.test', fetchImpl,
    })).rejects.toMatchObject({ code: 'unauthenticated', status: 401 });
  });

  it('network/dependency failure remains typed internal', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new Error('connection refused')));
    try {
      await fetchBootstrapMe('valid', { apiBaseUrl: 'https://api.example.test', fetchImpl });
      throw new Error('expected dependency failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'internal', message: 'connection refused' });
    }
  });
});