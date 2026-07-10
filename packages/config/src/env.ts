import { z } from 'zod';

/**
 * Single source of truth for environment configuration (project-structure.md §5,
 * coding-standards.md §2): `process.env` is read HERE and nowhere else.
 * Every other package/app receives a typed `Env` (or a narrower slice) by injection.
 */

/** Empty strings in .env files mean "unset". */
const emptyToUndefined = (v: unknown): unknown => (v === '' ? undefined : v);

export const envSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(['development', 'test', 'production']).default('development'),
  ),

  // Data layer
  DATABASE_URL: z.preprocess(
    emptyToUndefined,
    z.string().min(1).startsWith('postgresql://', 'DATABASE_URL must be a postgresql:// URL'),
  ),
  REDIS_URL: z.preprocess(
    emptyToUndefined,
    z.string().min(1).startsWith('redis://', 'REDIS_URL must be a redis:// URL'),
  ),
  S3_BUCKET: z.preprocess(emptyToUndefined, z.string().min(1)),
  /** Optional MinIO/S3 wiring — when absent, apps fall back to the in-memory ObjectStorage fake (CI). */
  S3_ENDPOINT: z.preprocess(emptyToUndefined, z.string().url().optional()),
  S3_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  S3_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

  // HTTP
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(3001)),

  // Auth (managed provider — never roll our own; dev = locally-signed HS256 JWT)
  AUTH_PROVIDER: z.preprocess(emptyToUndefined, z.enum(['dev', 'clerk', 'workos']).default('dev')),
  DEV_AUTH_SECRET: z.preprocess(
    emptyToUndefined,
    z.string().min(32, 'DEV_AUTH_SECRET must be at least 32 chars'),
  ),

  // LLM gateway (ADR-001: single vendor, two tiers)
  LLM_PRIMARY_PROVIDER: z.preprocess(emptyToUndefined, z.literal('anthropic').default('anthropic')),
  LLM_CHEAP_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).default('claude-3-5-haiku-latest')),
  LLM_FRONTIER_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).default('claude-sonnet-4-5')),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

  // Capability-gate approval-token signing secret (security-critical)
  APPROVAL_TOKEN_SECRET: z.preprocess(
    emptyToUndefined,
    z.string().min(32, 'APPROVAL_TOKEN_SECRET must be at least 32 chars'),
  ),

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess(emptyToUndefined, z.string().url().optional()),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Parse and cache the environment. This is the ONLY sanctioned `process.env` read
 * in the repo. Throws (fail-loud) on invalid/missing configuration.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  if (cached !== null) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: clear the memoized env. */
export function resetEnvCache(): void {
  cached = null;
}
