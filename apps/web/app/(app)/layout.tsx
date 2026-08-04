import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  AppShell,
  SessionProvider,
  type PublicSession,
} from '@/shell';
import {
  evaluateAuthGuard,
  fetchOnboardingComplete,
  getServerAuthProvider,
  SESSION_COOKIE_NAME,
} from '@/auth';
import { loadWebEnv } from '@/config/env';

/**
 * `(app)` route group — the authenticated shell.
 *
 * Server component: runs the guard on every request, and only renders the
 * `AppShell` (client) once we have a verified `Session`. The guard:
 *
 *   1. Reads the httpOnly session cookie.
 *   2. Verifies the JWT via the active `ServerAuthProvider`.
 *   3. Confirms the user has completed onboarding by calling `/v1/me`.
 *
 * Any failure short-circuits into a `redirect(...)` — Next.js unwinds the
 * render and the client never sees the shell (or any child room). The
 * verified `PublicSession` (userId + onboardingComplete only — the raw JWT
 * stays server-side) is handed to the client SessionProvider, which wires
 * the API client to fetch tokens over a same-origin bridge.
 */
export default async function AppLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const env = loadWebEnv();
  const outcome = await evaluateAuthGuard({
    authProvider: getServerAuthProvider(),
    readSessionCookie: () => cookies().get(SESSION_COOKIE_NAME)?.value ?? null,
    isOnboardingComplete: async ({ token }) =>
      fetchOnboardingComplete({ token }, { apiBaseUrl: env.NEXT_PUBLIC_API_BASE_URL }),
  });

  if (outcome.kind === 'redirect') {
    redirect(outcome.to);
  }

  const publicSession: PublicSession = {
    userId: outcome.session.userId,
    onboardingComplete: outcome.session.onboardingComplete,
  };

  return (
    <SessionProvider session={publicSession}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}