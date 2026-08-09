import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  AppShell,
  SessionProvider,
  type PublicSession,
} from '@/shell';
import {
  evaluateCurrentAuthenticatedRoute,
  actionForAuthenticatedRoute,
  RoutingRecovery,
} from '@/auth';

/**
 * `(app)` route group — the authenticated shell.
 *
 * Server component: runs the guard on every request, and only renders the
 * `AppShell` (client) once we have a verified `Session`. The guard:
 *
 *   1. Reads the httpOnly session cookie.
 *   2. Verifies the JWT via the active `ServerAuthProvider`.
 *   3. Explicitly bootstraps identity/settings and reads backend-owned onboarding
 *      state via `POST /v1/me/bootstrap`.
 *
 * Unauthenticated/required states redirect; dependency failures render visible
 * recovery. The verified `PublicSession` (userId only — the raw JWT stays
 * server-side) is handed to the client SessionProvider, which wires
 * the API client to fetch tokens over a same-origin bridge.
 */
export default async function AppLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const action = actionForAuthenticatedRoute(await evaluateCurrentAuthenticatedRoute(), 'app');
  switch (action.kind) {
    case 'redirect': redirect(action.to);
    case 'render_recovery': return <RoutingRecovery error={action.error} retryHref="/today" />;
    case 'render_app': break;
    case 'render_onboarding': throw new Error('App guard cannot render onboarding content.');
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }

  const publicSession: PublicSession = { userId: action.me.user.id };

  return (
    <SessionProvider session={publicSession}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}