/**
 * Clerk provider — **STUB** (FM1 defers real Clerk wiring).
 *
 * FM1 Task 6 explicitly defers Clerk to a later milestone ("Defer Clerk
 * (prod-only) — clearly-marked stub, don't wire it"). This file exists so
 * the auth factory can switch on `AUTH_PROVIDER=clerk` and fail loudly with
 * a clear error, rather than the boot silently degrading to no-auth.
 *
 * When we wire Clerk (post-FM2), replace the throws with `@clerk/nextjs`
 * calls that:
 *   - `verifyToken`: use `authenticateRequest` / JWKS verification, return
 *     the resolved `userId` (or null on 401).
 *   - `mintToken`: Clerk mints server-side; either delegate to Clerk sessions
 *     directly or use a template. `mintToken` is not called by app code —
 *     only the dev provider needs it (dev sign-in) — so it can throw.
 */
import type { ServerAuthProvider } from './types.js';

/**
 * Return a Clerk-shaped provider whose methods throw with a clear stub
 * message. The auth factory calls this when `AUTH_PROVIDER=clerk`; the
 * throw surfaces at boot in dev/CI (where clerk isn't wired), preventing
 * a silent no-auth footgun.
 */
export function createClerkAuthProviderStub(): ServerAuthProvider {
  const notImplemented = (method: string): never => {
    throw new Error(
      `Clerk auth provider is not wired yet (${method}). ` +
        `FM1 ships only the dev provider; Clerk arrives with the prod cutover. ` +
        `Set AUTH_PROVIDER=dev (or NEXT_PUBLIC_AUTH_PROVIDER=dev) for now.`,
    );
  };
  return {
    kind: 'clerk',
    // eslint-disable-next-line @typescript-eslint/require-await
    mintToken: async (): Promise<string> => notImplemented('mintToken'),
    // eslint-disable-next-line @typescript-eslint/require-await
    verifyToken: async (): Promise<string | null> => notImplemented('verifyToken'),
  };
}