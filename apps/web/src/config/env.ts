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