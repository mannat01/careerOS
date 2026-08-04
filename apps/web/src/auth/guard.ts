/**
 * Server-side auth guard for the (app) route group.
 *
 * Enforces two invariants at the boundary:
 *   1. Signed-in: the session cookie carries a valid JWT (verified by the
 *      active `ServerAuthProvider`); otherwise redirect to `/sign-in`.
 *   2. Onboarding complete: `/v1/me` reports `onboardingComplete=true`;
 *      otherwise redirect to `/onboarding` (a stub in FM1 — the actual
 *      onboarding flow lands with FM2).
 *
 * The guard is intentionally infrastructure-agnostic: it takes readers for
 * the cookie + onboarding lookup so it can be unit-tested without booting
 * Next.js. The route handler in `app/(app)/layout.tsx` wires it to
 * `next/headers` + a live fetch to the API.
 */
import type { ServerAuthProvider, Session } from './types.js';

export type GuardOutcome =
  | { kind: 'ok'; session: Session }
  | { kind: 'redirect'; to: '/sign-in' | '/onboarding' };

/**
 * Injectable dependencies for the guard. Tests substitute deterministic
 * stubs; the Next.js layout provides real implementations.
 */
export interface GuardDeps {
  /** The active auth provider (dev-JWT or Clerk stub). */
  authProvider: ServerAuthProvider;
  /** Return the raw session cookie value, or null when the user has none. */
  readSessionCookie: () => string | null;
  /**
   * Given a verified `token` + `userId`, return whether the user has
   * completed onboarding. Wraps a call to the API's `/v1/me`.
   *
   * Returning `null` means the API call failed (network / 5xx); the guard
   * treats that as "not authenticated" and redirects to sign-in, since we
   * cannot prove the user is allowed to see (app) content.
   */
  isOnboardingComplete: (args: { userId: string; token: string }) => Promise<boolean | null>;
}

/**
 * Evaluate the guard for the current request. Callers apply the redirect;
 * the guard itself returns a value (pure) so tests can assert every branch
 * without mocking `next/navigation`.
 */
export async function evaluateAuthGuard(deps: GuardDeps): Promise<GuardOutcome> {
  const token = deps.readSessionCookie();
  if (token === null || token.length === 0) {
    return { kind: 'redirect', to: '/sign-in' };
  }

  const userId = await deps.authProvider.verifyToken(token);
  if (userId === null) {
    // Expired / signature failed / malformed — treat as signed-out. The
    // API client's 401→refresh-once path handles in-flight requests; the
    // guard just picks up the sign-out on the next server render.
    return { kind: 'redirect', to: '/sign-in' };
  }

  const onboarded = await deps.isOnboardingComplete({ userId, token });
  if (onboarded === null) {
    // API unavailable — safer to bounce to sign-in than to render (app)
    // shell against unknown identity state.
    return { kind: 'redirect', to: '/sign-in' };
  }
  if (!onboarded) {
    return { kind: 'redirect', to: '/onboarding' };
  }

  return {
    kind: 'ok',
    session: { userId, token, onboardingComplete: true },
  };
}