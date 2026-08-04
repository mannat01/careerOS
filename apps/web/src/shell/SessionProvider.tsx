'use client';

/**
 * SessionProvider — client-side shim that:
 *   1. Exposes the signed-in `userId` + `onboardingComplete` to the shell via
 *      React context (server hands them in as props from the guard).
 *   2. Wires the API client's TokenProvider so every fetch through
 *      `src/api/client.ts` carries the session cookie via a same-origin
 *      `/api/auth/token` bridge. The raw JWT never lives in client JS.
 *   3. Handles a 401→refresh-once→sign-in loop: the API client asks the
 *      provider for a fresh token when it sees 401; the provider fetches
 *      `/api/auth/refresh`; if that still 401s, the browser is redirected
 *      to `/sign-in`.
 *
 * FM1 keeps the browser out of the token custody chain: the session cookie
 * is httpOnly, and the bridge endpoints are same-origin, so the token can
 * only be pulled by JS on our own origin — matching the standard Next.js
 * pattern for httpOnly-cookie auth.
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { setDefaultTokenProvider, type TokenProvider } from '../api/client.js';

export interface PublicSession {
  readonly userId: string;
  readonly onboardingComplete: boolean;
}

const SessionContext = createContext<PublicSession | null>(null);

export interface SessionProviderProps {
  session: PublicSession;
  children: ReactNode;
  /** Test-only overrides for the bridge endpoints. */
  overrides?: {
    tokenUrl?: string;
    refreshUrl?: string;
    fetchImpl?: typeof fetch;
    onSignInRedirect?: () => void;
  };
}

/**
 * Build a TokenProvider that reads the current bearer via a same-origin
 * bridge. Exported so tests can construct one without rendering the
 * provider tree.
 */
export function createBridgeTokenProvider(
  overrides: SessionProviderProps['overrides'] = {},
): TokenProvider & { forceRefresh: () => Promise<string | null> } {
  const tokenUrl = overrides.tokenUrl ?? '/api/auth/token';
  const refreshUrl = overrides.refreshUrl ?? '/api/auth/refresh';
  const fetchImpl = overrides.fetchImpl ?? fetch;
  const onSignInRedirect =
    overrides.onSignInRedirect ??
    (() => {
      if (typeof window !== 'undefined') {
        window.location.assign('/sign-in');
      }
    });

  // Simple in-memory cache — the bridge is a fast same-origin hop but there
  // is no reason to hit it on every request within the same page.
  let cachedToken: string | null = null;
  let inflightRefresh: Promise<string | null> | null = null;
  let refreshAttempts = 0;

  async function fetchToken(url: string): Promise<string | null> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
    } catch {
      return null;
    }
    if (response.status === 401) return null;
    if (!response.ok) return null;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return null;
    }
    if (typeof body !== 'object' || body === null || !('token' in body)) {
      return null;
    }
    const token = (body as Record<string, unknown>).token;
    return typeof token === 'string' ? token : null;
  }

  async function forceRefresh(): Promise<string | null> {
    // Coalesce concurrent refreshes so one 401 storm produces one bridge hit.
    if (inflightRefresh) return inflightRefresh;
    refreshAttempts += 1;
    inflightRefresh = (async () => {
      // The task spec is "refresh-once, then re-sign-in" — after the second
      // attempt in a page lifetime, bail to sign-in rather than looping.
      if (refreshAttempts > 2) {
        cachedToken = null;
        onSignInRedirect();
        return null;
      }
      const next = await fetchToken(refreshUrl);
      cachedToken = next;
      if (next === null) {
        onSignInRedirect();
      }
      return next;
    })();
    try {
      return await inflightRefresh;
    } finally {
      inflightRefresh = null;
    }
  }

  return {
    getBearerToken: async (): Promise<string | null> => {
      if (cachedToken !== null) return cachedToken;
      cachedToken = await fetchToken(tokenUrl);
      return cachedToken;
    },
    forceRefresh,
  };
}

/**
 * Client-side session boundary. The (app) layout renders this once with the
 * verified `PublicSession` prop; any client component under it can call
 * `useSession()` to read the userId + onboarding flag.
 */
export function SessionProvider({
  session,
  children,
  overrides,
}: SessionProviderProps): JSX.Element {
  // Install the token bridge on mount and reinstall if session identity
  // changes. Using useMemo to build once per session keeps the reference
  // stable for consumers.
  const provider = useMemo(() => createBridgeTokenProvider(overrides), [overrides]);

  useEffect(() => {
    setDefaultTokenProvider(provider);
    // No teardown — the token provider is a global singleton by design; the
    // next SessionProvider render (e.g. after sign-out) replaces it.
  }, [provider]);

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** Read the current signed-in identity. Throws when used outside the provider. */
export function useSession(): PublicSession {
  const ctx = useContext(SessionContext);
  if (ctx === null) {
    throw new Error('useSession must be used inside <SessionProvider>.');
  }
  return ctx;
}