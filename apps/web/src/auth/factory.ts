/**
 * Auth provider factory — the single choke point that decides whether the
 * app runs against the dev-JWT provider or the (stubbed) Clerk provider.
 *
 * Design principles:
 *   - Env is the single source of truth: `AUTH_PROVIDER` (server) mirrors
 *     `NEXT_PUBLIC_AUTH_PROVIDER` (client) so both sides pick the same
 *     backend. A mismatch fails loudly at boot.
 *   - Never guess. If `AUTH_PROVIDER=dev` and `DEV_AUTH_SECRET` is missing,
 *     throw — we do NOT silently mint tokens with a hardcoded default.
 *   - Test-injectable: the factory accepts an `env` object so unit tests
 *     don't have to mutate `process.env`.
 *
 * Only server code (route handlers, server components, middleware) should
 * call `getServerAuthProvider()`. The client side reads the bearer token
 * from an httpOnly cookie via the SessionProvider bridge.
 */
import { createDevAuthProvider } from './dev-provider';
import { createClerkAuthProviderStub } from './clerk-provider';
import type { AuthProviderKind, ServerAuthProvider } from './types';
import { loadWebServerEnv } from '../config/env';

export interface AuthEnv {
  /** Which backend to activate. Must be one of `AuthProviderKind`. */
  AUTH_PROVIDER: AuthProviderKind;
  /** HS256 signing secret; required when `AUTH_PROVIDER=dev`. */
  DEV_AUTH_SECRET?: string;
  /** Token TTL for the dev provider (jose duration string, e.g. `1h`). */
  DEV_AUTH_TOKEN_TTL?: string;
}

/**
 * Read + validate the auth-related environment. Exported for tests so they
 * can drive the factory with a known-good `AuthEnv` value instead of
 * touching `process.env`.
 */
/**
 * Test-friendly env source. Accepts a plain record so tests can pass
 * `{ AUTH_PROVIDER: 'dev', DEV_AUTH_SECRET: '…' }` without touching
 * `process.env` (which is banned outside `src/config/env.*`).
 *
 * In production, callers pass no argument and the factory pulls the env from
 * `loadWebServerEnv()` via `getServerAuthProvider()` below.
 */
type AuthEnvSource = Partial<Record<'AUTH_PROVIDER' | 'DEV_AUTH_SECRET' | 'DEV_AUTH_TOKEN_TTL', string | undefined>>;

export function readAuthEnv(source: AuthEnvSource): AuthEnv {
  const raw = source.AUTH_PROVIDER;
  if (raw !== 'dev' && raw !== 'clerk') {
    throw new Error(
      `AUTH_PROVIDER must be 'dev' or 'clerk' (got: ${JSON.stringify(raw)}).`,
    );
  }
  const env: AuthEnv = { AUTH_PROVIDER: raw };
  if (source.DEV_AUTH_SECRET !== undefined) {
    env.DEV_AUTH_SECRET = source.DEV_AUTH_SECRET;
  }
  if (source.DEV_AUTH_TOKEN_TTL !== undefined) {
    env.DEV_AUTH_TOKEN_TTL = source.DEV_AUTH_TOKEN_TTL;
  }
  return env;
}

/**
 * Build a ServerAuthProvider from a validated env. Kept pure so tests can
 * call it directly.
 */
export function buildServerAuthProvider(env: AuthEnv): ServerAuthProvider {
  if (env.AUTH_PROVIDER === 'dev') {
    if (env.DEV_AUTH_SECRET === undefined || env.DEV_AUTH_SECRET.length < 16) {
      // Refuse to run with a weak or missing secret — a 0-byte secret would
      // sign a valid JWT that ANYONE could verify, effectively no-auth.
      throw new Error(
        'DEV_AUTH_SECRET is required and must be at least 16 chars when AUTH_PROVIDER=dev.',
      );
    }
    const options: Parameters<typeof createDevAuthProvider>[0] = {
      secret: env.DEV_AUTH_SECRET,
    };
    if (env.DEV_AUTH_TOKEN_TTL !== undefined) {
      options.expiresIn = env.DEV_AUTH_TOKEN_TTL;
    }
    return createDevAuthProvider(options);
  }
  // env.AUTH_PROVIDER === 'clerk'
  return createClerkAuthProviderStub();
}

// ---------- module-level singleton (server) ----------

let cached: ServerAuthProvider | undefined;

/**
 * The app-wide ServerAuthProvider. First call reads env; subsequent calls
 * reuse it. Route handlers, middleware, and server components should call
 * this rather than building their own provider.
 */
export function getServerAuthProvider(): ServerAuthProvider {
  if (!cached) {
    const env = loadWebServerEnv();
    cached = buildServerAuthProvider({
      AUTH_PROVIDER: env.AUTH_PROVIDER,
      ...(env.DEV_AUTH_SECRET !== undefined ? { DEV_AUTH_SECRET: env.DEV_AUTH_SECRET } : {}),
    });
  }
  return cached;
}

/** Test-only reset for the memoized provider. */
export function _resetServerAuthProviderForTests(): void {
  cached = undefined;
}