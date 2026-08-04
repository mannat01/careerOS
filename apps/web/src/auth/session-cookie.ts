/**
 * Session cookie helpers — server-side read/write of the bearer token.
 *
 * FM1 stores the dev-JWT in an httpOnly cookie so the token is NEVER
 * accessible to JS in the browser (blocks XSS token exfiltration). The
 * SessionProvider client component reads the userId + onboardingComplete
 * from a server-rendered prop, then forwards each API call through
 * `/api/auth/proxy` — but the raw JWT never crosses into client JS.
 *
 * Cookie name is stable so tests + e2e can set it deterministically.
 */

import { loadWebServerEnv } from '../config/env.js';

/** Cookie name — kept stable so the API client + tests agree. */
export const SESSION_COOKIE_NAME = 'careeros_session';

/**
 * Build cookie options for setting the session cookie. Kept as a factory so
 * tests can override maxAge without importing next/headers.
 */
export interface SessionCookieOptions {
  maxAgeSeconds?: number;
  /** Force `secure` on for tests that assert the flag; defaults to prod-shape. */
  secure?: boolean;
}

export function sessionCookieAttrs(
  options: SessionCookieOptions = {},
): {
  name: string;
  httpOnly: true;
  sameSite: 'lax';
  path: '/';
  secure: boolean;
  maxAge: number;
} {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // Default: on outside test/dev. Callers can override for a specific
    // response (e.g. the sign-in route in prod always wants `secure: true`).
    // We read NODE_ENV through the config module so this file doesn't touch
    // `process.env` directly (only `src/config/env.*` is allowed to).
    secure: options.secure ?? loadWebServerEnv().NODE_ENV === 'production',
    maxAge: options.maxAgeSeconds ?? 60 * 60, // 1 hour, matches dev JWT TTL
  };
}