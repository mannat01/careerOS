import { describe, expect, it, vi } from 'vitest';
import { defaultUserSettings, meResponseSchema, type MeResponse } from '@careeros/contracts';
import { ApiError } from '../api/errors';
import {
  actionForAuthenticatedRoute,
  evaluateAuthenticatedRoute,
  type GuardDeps,
} from './guard';
import type { ServerAuthProvider } from './types';

const NOW = '2026-08-09T12:00:00.000Z';
const USER_ID = '00000000-0000-4000-8000-000000000123';

function me(status: 'required' | 'complete'): MeResponse {
  const completedAt = status === 'complete' ? NOW : null;
  return meResponseSchema.parse({
    user: {
      id: USER_ID, email: 'route@example.test', authProviderId: `dev|${USER_ID}`,
      subscriptionTier: 'free', status: 'active', onboardingCompletedAt: completedAt,
      createdAt: NOW, updatedAt: NOW,
    },
    settings: defaultUserSettings(USER_ID, NOW),
    onboarding: status === 'complete'
      ? { status: 'complete', completedAt: NOW }
      : { status: 'required', completedAt: null },
  });
}

function provider(overrides: Partial<ServerAuthProvider> = {}): ServerAuthProvider {
  return {
    kind: 'dev',
    mintToken: vi.fn(() => Promise.resolve('minted')),
    verifyToken: vi.fn(() => Promise.resolve<string | null>(USER_ID)),
    ...overrides,
  };
}

function deps(overrides: Partial<GuardDeps> = {}): GuardDeps {
  return {
    authProvider: provider(),
    readSessionCookie: () => 'valid-token',
    bootstrap: vi.fn(() => Promise.resolve(me('complete'))),
    refresh: vi.fn(() => Promise.resolve<string | null>('fresh-token')),
    ...overrides,
  };
}

describe('authoritative authenticated route decision', () => {
  it.each([null, ''])('no usable session (%s) is unauthenticated', async (cookie) => {
    expect(await evaluateAuthenticatedRoute(deps({ readSessionCookie: () => cookie })))
      .toEqual({ kind: 'unauthenticated' });
  });

  it('invalid verified session is unauthenticated', async () => {
    const decision = await evaluateAuthenticatedRoute(deps({
      authProvider: provider({ verifyToken: vi.fn(() => Promise.resolve(null)) }),
    }));
    expect(decision).toEqual({ kind: 'unauthenticated' });
  });

  it('backend required discriminant routes app → onboarding', async () => {
    const required = me('required');
    const decision = await evaluateAuthenticatedRoute(deps({
      bootstrap: vi.fn(() => Promise.resolve(required)),
    }));
    expect(decision).toEqual({ kind: 'onboarding_required', me: required });
    expect(actionForAuthenticatedRoute(decision, 'app'))
      .toEqual({ kind: 'redirect', to: '/onboarding' });
    expect(actionForAuthenticatedRoute(decision, 'onboarding'))
      .toEqual({ kind: 'render_onboarding', me: required });
  });

  it('backend complete discriminant routes app → ready and onboarding → Today', async () => {
    const complete = me('complete');
    const decision = await evaluateAuthenticatedRoute(deps({
      bootstrap: vi.fn(() => Promise.resolve(complete)),
    }));
    expect(decision).toEqual({ kind: 'ready', me: complete });
    expect(actionForAuthenticatedRoute(decision, 'app'))
      .toEqual({ kind: 'render_app', me: complete });
    expect(actionForAuthenticatedRoute(decision, 'onboarding'))
      .toEqual({ kind: 'redirect', to: '/today' });
  });

  it('dependency/internal failure renders recovery and never redirects', async () => {
    const error = new ApiError({ code: 'internal', message: 'db unavailable', traceId: 'trace-route' });
    const decision = await evaluateAuthenticatedRoute(deps({
      bootstrap: vi.fn(() => Promise.reject(error)),
    }));
    expect(decision).toEqual({ kind: 'dependency_error', error });
    expect(actionForAuthenticatedRoute(decision, 'app')).toEqual({ kind: 'render_recovery', error });
    expect(actionForAuthenticatedRoute(decision, 'onboarding')).toEqual({ kind: 'render_recovery', error });
  });

  it('a genuine 401 refreshes once, retries once, and succeeds without a loop', async () => {
    const bootstrap = vi.fn()
      .mockRejectedValueOnce(new ApiError({ code: 'unauthenticated', message: 'expired', status: 401 }))
      .mockResolvedValueOnce(me('complete'));
    const refresh = vi.fn(() => Promise.resolve<string | null>('fresh-token'));
    const decision = await evaluateAuthenticatedRoute(deps({ bootstrap, refresh }));
    expect(decision.kind).toBe('ready');
    expect(refresh).toHaveBeenCalledOnce();
    expect(bootstrap).toHaveBeenNthCalledWith(1, 'valid-token');
    expect(bootstrap).toHaveBeenNthCalledWith(2, 'fresh-token');
  });

  it('a second 401 stops as unauthenticated; refresh is never repeated', async () => {
    const bootstrap = vi.fn(() => Promise.reject(
      new ApiError({ code: 'unauthenticated', message: 'expired', status: 401 }),
    ));
    const refresh = vi.fn(() => Promise.resolve<string | null>('fresh-token'));
    expect(await evaluateAuthenticatedRoute(deps({ bootstrap, refresh })))
      .toEqual({ kind: 'unauthenticated' });
    expect(refresh).toHaveBeenCalledOnce();
    expect(bootstrap).toHaveBeenCalledTimes(2);
  });

  it('does not infer from timestamps, settings, or resource presence', async () => {
    const required = me('required');
    const misleading = {
      ...required,
      user: { ...required.user, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: NOW },
      settings: { ...required.settings, updatedAt: NOW },
    } satisfies MeResponse;
    const decision = await evaluateAuthenticatedRoute(deps({
      bootstrap: vi.fn(() => Promise.resolve(misleading)),
    }));
    expect(decision.kind).toBe('onboarding_required');
  });
});