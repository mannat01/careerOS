/**
 * apps/web typed config — the ONLY module allowed to read environment.
 *
 * Mirrors the backend's `@careeros/config/loadEnv()` pattern: parse once at
 * boot with a zod schema, fail loudly on missing/invalid, expose a frozen
 * typed value everywhere else. See docs/frontend-architecture.md §1 and
 * docs/frontend-milestone-01-workorder.md task 1.
 *
 * Only vars prefixed `NEXT_PUBLIC_` are safe on the client bundle; anything
 * server-only stays server-only. Do NOT read `process.env` anywhere else in
 * apps/web — the ESLint `webBoundary` overlay + base preset will fail the
 * build if you try.
 */
/* eslint-disable no-restricted-properties -- this module IS the env boundary */
import { z } from 'zod';

const publicSchema = z.object({
  /** Base URL for the CareerOS API (e.g. http://localhost:3001). Trailing slash stripped. */
  NEXT_PUBLIC_API_BASE_URL: z
    .string()
    .url()
    .transform((v) => v.replace(/\/+$/, '')),
  /** Auth provider — must match the backend's `AUTH_PROVIDER`. */
  NEXT_PUBLIC_AUTH_PROVIDER: z.enum(['dev', 'clerk']),
  /** Optional OTel collector endpoint for the web tracer. */
  NEXT_PUBLIC_OTEL_ENDPOINT: z.string().url().optional(),
});

export type WebEnv = z.infer<typeof publicSchema>;

let cached: WebEnv | undefined;

export function loadWebEnv(): WebEnv {
  if (cached) return cached;
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_AUTH_PROVIDER: process.env.NEXT_PUBLIC_AUTH_PROVIDER,
    NEXT_PUBLIC_OTEL_ENDPOINT: process.env.NEXT_PUBLIC_OTEL_ENDPOINT,
  });
  if (!parsed.success) {
    // Fail fast, with a message that names every missing/invalid key.
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid web environment: ${issues}`);
  }
  cached = Object.freeze(parsed.data);
  return cached;
}

/** Test-only: clear the memoized env so a suite can reparse with a mutated env. */
export function _resetWebEnvCacheForTests(): void {
  cached = undefined;
}

// ---------------------------------------------------------------------------
// Server-only env (never bundled to the client).
//
// The rules of this repo say `process.env` is only allowed inside
// `apps/web/src/config/env.*`. The auth factory + cookie helpers need three
// server-only knobs, so we surface them here through a second schema. Callers
// must be server-side (route handlers, RSCs, middleware) — the ESLint web
// boundary prevents `use client` files from importing this module beyond the
// `NEXT_PUBLIC_*` shape.
// ---------------------------------------------------------------------------

const serverSchema = z.object({
  /**
   * Server-authoritative auth provider. Must match `NEXT_PUBLIC_AUTH_PROVIDER`
   * (the guards + factory read this one; the public one is only for the
   * client bundle's feature flags).
   */
  AUTH_PROVIDER: z.enum(['dev', 'clerk']),
  /**
   * HS256 secret used by the dev provider. Required only when
   * `AUTH_PROVIDER=dev`; validated by the factory (which enforces a minimum
   * length). We accept it as an optional string here so `AUTH_PROVIDER=clerk`
   * environments (which never see this key) don't fail schema parsing.
   */
  DEV_AUTH_SECRET: z.string().optional(),
  /** NODE_ENV — used by the cookie helper to pick `Secure` on/off. */
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type WebServerEnv = z.infer<typeof serverSchema>;

let cachedServer: WebServerEnv | undefined;

export function loadWebServerEnv(): WebServerEnv {
  if (cachedServer) return cachedServer;
  const parsed = serverSchema.safeParse({
    AUTH_PROVIDER: process.env.AUTH_PROVIDER,
    DEV_AUTH_SECRET: process.env.DEV_AUTH_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid web server environment: ${issues}`);
  }
  cachedServer = Object.freeze(parsed.data);
  return cachedServer;
}

/** Test-only: clear the server env cache. */
export function _resetWebServerEnvCacheForTests(): void {
  cachedServer = undefined;
}
