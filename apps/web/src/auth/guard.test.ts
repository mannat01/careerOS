/**
 * Unit tests for the (app) route-group auth guard.
 *
 * The guard is deliberately pure: it takes injectable readers for the
 * session cookie and the onboarding check so we can enumerate every
 * decision branch without booting Next.js.
 *
 * Branches covered:
 *   - no cookie             → redirect /sign-in
 *   - empty cookie          → redirect /sign-in
 *   - invalid token         → redirect /sign-in
 *   - API failure (null)    → redirect /sign-in (fail-closed)
 *   - onboarding incomplete → redirect /onboarding
 *   - happy path            → ok + session { userId, token, onboardingComplete }
 */
import { describe, expect, it, vi } from 'vitest';
import { evaluateAuthGuard, type GuardDeps } from './guard.js';
import type { ServerAuthProvider } from './types.js';

function makeProvider(overrides: Partial<ServerAuthProvider> = {}): ServerAuthProvider {
  return {
    kind: 'dev',
    mintToken: vi.fn(() => Promise.resolve('minted')),
    verifyToken: vi.fn(() => Promise.resolve<string | null>('user-1')),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<GuardDeps> = {}): GuardDeps {
  return {
    authProvider: makeProvider(),
    readSessionCookie: () => 'valid-token',
    isOnboardingComplete: vi.fn(() => Promise.resolve<boolean | null>(true)),
    ...overrides,
  };
}

describe('evaluateAuthGuard', () => {
  it('redirects to /sign-in when the session cookie is absent', async () => {
    const outcome = await evaluateAuthGuard(makeDeps({ readSessionCookie: () => null }));
    expect(outcome).toEqual({ kind: 'redirect', to: '/sign-in' });
  });

  it('redirects to /sign-in when the session cookie is empty', async () => {
    const outcome = await evaluateAuthGuard(makeDeps({ readSessionCookie: () => '' }));
    expect(outcome).toEqual({ kind: 'redirect', to: '/sign-in' });
  });

  it('redirects to /sign-in when the token fails verification', async () => {
    const outcome = await evaluateAuthGuard(
      makeDeps({
        authProvider: makeProvider({ verifyToken: vi.fn(() => Promise.resolve<string | null>(null)) }),
      }),
    );
    expect(outcome).toEqual({ kind: 'redirect', to: '/sign-in' });
  });

  it('fails closed to /sign-in when the onboarding lookup errors (null)', async () => {
    const outcome = await evaluateAuthGuard(
      makeDeps({ isOnboardingComplete: vi.fn(() => Promise.resolve<boolean | null>(null)) }),
    );
    expect(outcome).toEqual({ kind: 'redirect', to: '/sign-in' });
  });

  it('redirects to /onboarding when the user is signed-in but not onboarded', async () => {
    const outcome = await evaluateAuthGuard(
      makeDeps({ isOnboardingComplete: vi.fn(() => Promise.resolve<boolean | null>(false)) }),
    );
    expect(outcome).toEqual({ kind: 'redirect', to: '/onboarding' });
  });

  it('returns ok with the resolved session on the happy path', async () => {
    const isOnboardingComplete = vi.fn(() => Promise.resolve<boolean | null>(true));
    const verifyToken = vi.fn(() => Promise.resolve<string | null>('user-42'));
    const outcome = await evaluateAuthGuard(
      makeDeps({
        authProvider: makeProvider({ verifyToken }),
        readSessionCookie: () => 'good-token',
        isOnboardingComplete,
      }),
    );
    expect(outcome).toEqual({
      kind: 'ok',
      session: { userId: 'user-42', token: 'good-token', onboardingComplete: true },
    });
    expect(verifyToken).toHaveBeenCalledWith('good-token');
    expect(isOnboardingComplete).toHaveBeenCalledWith({
      userId: 'user-42',
      token: 'good-token',
    });
  });
});