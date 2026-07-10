import type { AuthProvider } from './auth-provider.js';
import type { RequestContext } from './request-context.js';

/**
 * ClerkAuthProvider — verifies a Clerk session token using JWKS.
 *
 * INACTIVE without CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY env vars.
 * This is a drop-in for production; tests use DevAuthProvider.
 *
 * Implementation note: Clerk's SDK (svix/sdk) verifies session tokens via JWKS.
 * The actual verification is delegated to @clerk/backend when available.
 * For now, this is a structural placeholder that always returns null
 * (fail-closed) when Clerk keys are absent.
 */
export class ClerkAuthProvider implements AuthProvider {
  // Not `async`: the stub has nothing to await (require-await). The Promise return
  // type is kept so the JWKS implementation slots in without an interface change.
  verify(_token: string): Promise<RequestContext | null> {
    // STUB(M01-3b-2): Integrate @clerk/backend JWKS verification.
    // Until CLERK_SECRET_KEY is present, this provider is inactive.
    // When active, it should:
    //   1. Extract the session ID from the token
    //   2. Verify the token signature against Clerk's JWKS endpoint
    //   3. Look up the userId from the session's user ID
    //   4. Return RequestContext with the verified userId
    return Promise.resolve(null);
  }
}
