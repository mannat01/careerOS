import { cookies } from 'next/headers';
import { loadWebEnv } from '../config/env';
import { evaluateAuthenticatedRoute, type AuthenticatedRouteDecision } from './guard';
import { fetchBootstrapMe } from './onboarding';
import { getServerAuthProvider } from './factory';
import { SESSION_COOKIE_NAME } from './session-cookie';

/** Shared server-only wiring for both the app guard and inverse onboarding guard. */
export function evaluateCurrentAuthenticatedRoute(): Promise<AuthenticatedRouteDecision> {
  const provider = getServerAuthProvider();
  const apiBaseUrl = loadWebEnv().NEXT_PUBLIC_API_BASE_URL;
  return evaluateAuthenticatedRoute({
    authProvider: provider,
    readSessionCookie: () => cookies().get(SESSION_COOKIE_NAME)?.value ?? null,
    bootstrap: (token) => fetchBootstrapMe(token, { apiBaseUrl }),
    refresh: async (token) => {
      const userId = await provider.verifyToken(token);
      return userId === null || provider.kind !== 'dev' ? null : provider.mintToken(userId);
    },
  });
}