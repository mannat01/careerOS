/**
 * Auth provider types for the CareerOS web app.
 *
 * FM1 Task 6 (`docs/frontend-milestone-01-workorder.md`) requires a provider
 * abstraction: **Dev-JWT** (local/CI/e2e) + **Clerk** (prod, behind config).
 * FM1 ships the dev provider fully wired; the Clerk implementation is a
 * clearly-marked stub (not wired) to keep the surface stable for FM2+.
 *
 * The abstraction lives in a small module so:
 *   - The API client can consume a `TokenProvider` without knowing which
 *     backend (dev / Clerk) minted the token.
 *   - Server components + route handlers can verify/mint tokens without
 *     leaking secrets to the client bundle (server-only providers hold the
 *     signing key; the client-facing surface only carries the JWT string).
 *   - Tests can inject a fake `Session` without spinning up Clerk.
 */

/**
 * Server-side session as verified by the guard. `token` is the raw bearer
 * that the server route guard sends in `Authorization: Bearer …`; `userId` is
 * the verified subject. Onboarding is intentionally not duplicated here: the
 * guard consumes `MeResponse.onboarding` directly.
 */
export interface Session {
  readonly userId: string;
  readonly token: string;
}

/**
 * Which provider is active. Sourced from `NEXT_PUBLIC_AUTH_PROVIDER` on the
 * client and `AUTH_PROVIDER` on the server; both must agree at boot.
 */
export type AuthProviderKind = 'dev' | 'clerk';

/**
 * Server-side auth surface: mint + verify. The Clerk implementation
 * delegates to the Clerk SDK; the dev implementation signs HS256 JWTs with
 * `DEV_AUTH_SECRET`. Only server code (route handlers, server components)
 * should touch this — the client only ever sees the raw JWT string.
 */
export interface ServerAuthProvider {
  readonly kind: AuthProviderKind;
  /**
   * Mint a bearer token for the given userId. Dev only in FM1 (Clerk
   * mints tokens via its own flow); the dev sign-in route uses this.
   */
  mintToken(userId: string, email?: string): Promise<string>;
  /**
   * Verify a bearer token. Returns the userId on success, `null` on
   * expiry / signature failure / malformed input. Never throws on a
   * "just invalid" input — that would break the 401 recovery path.
   */
  verifyToken(token: string): Promise<string | null>;
}