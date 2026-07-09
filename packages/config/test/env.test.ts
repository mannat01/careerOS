import { beforeEach, describe, expect, it } from 'vitest';
import { envSchema, loadEnv, resetEnvCache } from '../src/env.js';

const VALID: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost:5432/careeros',
  REDIS_URL: 'redis://localhost:6379',
  S3_BUCKET: 'careeros-artifacts',
  APPROVAL_TOKEN_SECRET: 'x'.repeat(32),
};

describe('env schema (packages/config)', () => {
  beforeEach(() => resetEnvCache());

  it('parses a valid environment and applies ADR-001 defaults', () => {
    const env = loadEnv(VALID);
    expect(env.DATABASE_URL).toBe(VALID['DATABASE_URL']);
    expect(env.LLM_PRIMARY_PROVIDER).toBe('anthropic');
    expect(env.LLM_CHEAP_MODEL.length).toBeGreaterThan(0);
    expect(env.LLM_FRONTIER_MODEL.length).toBeGreaterThan(0);
    expect(env.AUTH_PROVIDER).toBe('clerk');
  });

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL: _omit, ...rest } = VALID;
    expect(() => loadEnv(rest)).toThrowError(/DATABASE_URL/);
  });

  it('rejects a malformed DATABASE_URL', () => {
    expect(() => loadEnv({ ...VALID, DATABASE_URL: 'mysql://nope' })).toThrowError(/postgresql/);
  });

  it('rejects a weak APPROVAL_TOKEN_SECRET', () => {
    expect(() => loadEnv({ ...VALID, APPROVAL_TOKEN_SECRET: 'short' })).toThrowError(/32/);
  });

  it('treats empty strings as unset (env-file convention)', () => {
    const env = loadEnv({ ...VALID, LLM_CHEAP_MODEL: '', OTEL_EXPORTER_OTLP_ENDPOINT: '' });
    expect(env.LLM_CHEAP_MODEL).toBe('claude-3-5-haiku-latest');
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it('memoizes and can be reset for tests', () => {
    const a = loadEnv(VALID);
    const b = loadEnv({ ...VALID, S3_BUCKET: 'other' });
    expect(b).toBe(a);
    resetEnvCache();
    const c = loadEnv({ ...VALID, S3_BUCKET: 'other' });
    expect(c.S3_BUCKET).toBe('other');
  });

  it('unknown AUTH_PROVIDER fails closed', () => {
    const r = envSchema.safeParse({ ...VALID, AUTH_PROVIDER: 'homegrown' });
    expect(r.success).toBe(false);
  });
});
