/**
 * Dev JWT provider — HS256 tokens signed with `DEV_AUTH_SECRET`.
 *
 * Used for local / CI / e2e; mirrors the API's `apps/api/src/common/auth/
 * dev-auth-provider.ts` so a token minted here verifies there and vice
 * versa. Never enabled in production (that path uses Clerk; see
 * `clerk-provider.ts`).
 *
 * Server-only: this module imports `jose` and reads `DEV_AUTH_SECRET`, so it
 * MUST NOT be pulled into a client component. Route handlers, server
 * components, and the middleware are the only allowed callers. The dev sign-
 * in route calls `mintToken`; the guard + refresh handler call `verifyToken`.
 *
 * (We do not use the `server-only` package sentinel to avoid pulling another
 *  dep into the web bundle; the "server-only" contract is enforced by (a)
 *  this file being imported exclusively from route handlers / server
 *  components under `app/**` and (b) the ESLint boundary rule that forbids
 *  `use client` files from importing `src/auth/dev-provider`.)
 */
import { SignJWT, jwtVerify } from 'jose';
import type { ServerAuthProvider } from './types';

/** Test-visible so unit tests can drive `mintToken`/`verifyToken` without env. */
export interface DevProviderOptions {
  /** HS256 signing secret. In prod-shaped code this comes from `DEV_AUTH_SECRET`. */
  secret: string;
  /** Token lifetime. Short enough to exercise the 401→refresh path in e2e. */
  expiresIn?: string;
}

/**
 * Build a dev provider. Prefer the module-level `getDevAuthProvider()` in app
 * code; use the factory directly in tests to inject a fixed secret + TTL.
 */
export function createDevAuthProvider(options: DevProviderOptions): ServerAuthProvider {
  // NOTE: We wrap the TextEncoder output in `Uint8Array.from(...)` so the
  // resulting buffer is an instance of the *global* Uint8Array constructor.
  // Under vitest+jsdom the `TextEncoder` polyfill returns an array whose
  // constructor is jsdom's, and `jose@5` checks `payload instanceof
  // Uint8Array` — which fails across realms. Server code is unaffected.
  const secret = Uint8Array.from(new TextEncoder().encode(options.secret));
  const expiresIn = options.expiresIn ?? '1h';

  return {
    kind: 'dev',
    mintToken: async (userId: string, email?: string): Promise<string> => {
      if (userId.length === 0) {
        throw new Error('mintToken: userId must be non-empty');
      }
      return new SignJWT({ sub: userId, ...(email ? { email } : {}) })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(secret);
    },
    verifyToken: async (token: string): Promise<string | null> => {
      if (typeof token !== 'string' || token.length === 0) return null;
      try {
        const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
        const sub = payload.sub;
        return typeof sub === 'string' && sub.length > 0 ? sub : null;
      } catch {
        // Verify failures (expired, wrong signature, malformed) are a normal
        // path — the caller (guard) turns null into a redirect to sign-in.
        return null;
      }
    },
  };
}