/* eslint-disable no-restricted-properties -- test harness mutates process.env to exercise the boundary */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetWebEnvCacheForTests, loadWebEnv } from './env.js';

/**
 * The typed-env boundary is load-bearing (FM1 task 1): the rest of apps/web
 * calls `loadWebEnv()` and trusts the result. These tests pin the contract:
 * missing required keys throw, valid keys parse & freeze, and the result is
 * memoized so downstream modules don't re-parse on every render.
 */
const ORIGINAL = { ...process.env };

beforeEach(() => {
  _resetWebEnvCacheForTests();
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
  delete process.env.NEXT_PUBLIC_AUTH_PROVIDER;
  delete process.env.NEXT_PUBLIC_OTEL_ENDPOINT;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  _resetWebEnvCacheForTests();
});

describe('loadWebEnv', () => {
  it('parses a valid environment and strips trailing slashes on the API URL', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001/';
    process.env.NEXT_PUBLIC_AUTH_PROVIDER = 'dev';

    const env = loadWebEnv();

    expect(env.NEXT_PUBLIC_API_BASE_URL).toBe('http://localhost:3001');
    expect(env.NEXT_PUBLIC_AUTH_PROVIDER).toBe('dev');
    expect(env.NEXT_PUBLIC_OTEL_ENDPOINT).toBeUndefined();
  });

  it('memoizes the parsed env across calls', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001';
    process.env.NEXT_PUBLIC_AUTH_PROVIDER = 'dev';

    const first = loadWebEnv();
    const second = loadWebEnv();

    expect(second).toBe(first);
  });

  it('throws with a naming-every-missing-key message when required vars are absent', () => {
    expect(() => loadWebEnv()).toThrow(/NEXT_PUBLIC_API_BASE_URL/);
    _resetWebEnvCacheForTests();
    expect(() => loadWebEnv()).toThrow(/NEXT_PUBLIC_AUTH_PROVIDER/);
  });

  it('rejects a non-URL API base', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'not-a-url';
    process.env.NEXT_PUBLIC_AUTH_PROVIDER = 'dev';
    expect(() => loadWebEnv()).toThrow(/NEXT_PUBLIC_API_BASE_URL/);
  });

  it('rejects an unknown auth provider', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001';
    process.env.NEXT_PUBLIC_AUTH_PROVIDER = 'basic';
    expect(() => loadWebEnv()).toThrow(/NEXT_PUBLIC_AUTH_PROVIDER/);
  });
});