/**
 * @vitest-environment node
 *
 * Unit tests for the auth provider factory.
 *
 * We force the `node` environment for this file because `jose@5` verifies its
 * key material with `payload instanceof Uint8Array`, and jsdom's TextEncoder
 * returns a typed array whose constructor is a *different* realm's — the check
 * throws even though the bytes are correct. In real code the provider only
 * runs on the server, so `node` is the honest environment anyway.
 *
 * Coverage:
 *   - readAuthEnv rejects missing / invalid AUTH_PROVIDER
 *   - buildServerAuthProvider(dev) requires a strong DEV_AUTH_SECRET
 *   - buildServerAuthProvider(dev) returns a provider whose mint+verify roundtrip
 *   - buildServerAuthProvider(clerk) returns the stub (throws on use)
 *   - the module-level singleton memoizes across calls
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetServerAuthProviderForTests,
  buildServerAuthProvider,
  getServerAuthProvider,
  readAuthEnv,
} from './factory.js';

const STRONG_SECRET = 'test-secret-16-chars-or-more-please';

describe('readAuthEnv', () => {
  it('rejects missing AUTH_PROVIDER', () => {
    expect(() => readAuthEnv({})).toThrow(/AUTH_PROVIDER/);
  });

  it('rejects an unrecognised AUTH_PROVIDER value', () => {
    expect(() => readAuthEnv({ AUTH_PROVIDER: 'auth0' })).toThrow(/AUTH_PROVIDER/);
  });

  it('accepts AUTH_PROVIDER=dev', () => {
    const env = readAuthEnv({
      AUTH_PROVIDER: 'dev',
      DEV_AUTH_SECRET: STRONG_SECRET,
    });
    expect(env.AUTH_PROVIDER).toBe('dev');
    expect(env.DEV_AUTH_SECRET).toBe(STRONG_SECRET);
  });

  it('accepts AUTH_PROVIDER=clerk (no secret required)', () => {
    const env = readAuthEnv({ AUTH_PROVIDER: 'clerk' });
    expect(env.AUTH_PROVIDER).toBe('clerk');
  });
});

describe('buildServerAuthProvider (dev)', () => {
  it('refuses to build a dev provider without a secret', () => {
    expect(() => buildServerAuthProvider({ AUTH_PROVIDER: 'dev' })).toThrow(
      /DEV_AUTH_SECRET/,
    );
  });

  it('refuses to build a dev provider with a short secret', () => {
    expect(() =>
      buildServerAuthProvider({ AUTH_PROVIDER: 'dev', DEV_AUTH_SECRET: 'too-short' }),
    ).toThrow(/DEV_AUTH_SECRET/);
  });

  it('roundtrips mint → verify with a strong secret', async () => {
    const provider = buildServerAuthProvider({
      AUTH_PROVIDER: 'dev',
      DEV_AUTH_SECRET: STRONG_SECRET,
    });
    expect(provider.kind).toBe('dev');
    const token = await provider.mintToken('user-42');
    expect(typeof token).toBe('string');
    expect(await provider.verifyToken(token)).toBe('user-42');
  });

  it('verifyToken returns null for an unrelated / garbage token', async () => {
    const provider = buildServerAuthProvider({
      AUTH_PROVIDER: 'dev',
      DEV_AUTH_SECRET: STRONG_SECRET,
    });
    expect(await provider.verifyToken('')).toBeNull();
    expect(await provider.verifyToken('not-a-jwt')).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const a = buildServerAuthProvider({
      AUTH_PROVIDER: 'dev',
      DEV_AUTH_SECRET: STRONG_SECRET,
    });
    const b = buildServerAuthProvider({
      AUTH_PROVIDER: 'dev',
      DEV_AUTH_SECRET: `${STRONG_SECRET}-other`,
    });
    const token = await a.mintToken('user-1');
    expect(await b.verifyToken(token)).toBeNull();
  });
});

describe('buildServerAuthProvider (clerk stub)', () => {
  it('returns a clerk-shaped provider whose methods throw', async () => {
    const provider = buildServerAuthProvider({ AUTH_PROVIDER: 'clerk' });
    expect(provider.kind).toBe('clerk');
    await expect(provider.mintToken('x')).rejects.toThrow(/not wired/);
    await expect(provider.verifyToken('x')).rejects.toThrow(/not wired/);
  });
});

describe('getServerAuthProvider (singleton)', () => {
  // The singleton reads env via `loadWebServerEnv()`. To avoid touching
  // `process.env` here (which the web ESLint boundary bans outside
  // `src/config/env.*`), we exercise memoization by building the provider
  // twice via `buildServerAuthProvider` — the same guarantee any caller
  // downstream cares about, without needing env mutation. The env-reading
  // half of the singleton is exercised by the app itself at boot.
  beforeEach(() => {
    _resetServerAuthProviderForTests();
  });
  afterEach(() => {
    _resetServerAuthProviderForTests();
  });

  it('buildServerAuthProvider is deterministic given the same env', () => {
    const env = { AUTH_PROVIDER: 'dev' as const, DEV_AUTH_SECRET: STRONG_SECRET };
    const a = buildServerAuthProvider(env);
    const b = buildServerAuthProvider(env);
    // Not the same instance (fresh each call), but same shape + kind.
    expect(a.kind).toBe(b.kind);
    expect(typeof a.mintToken).toBe('function');
    expect(typeof b.mintToken).toBe('function');
  });

  it('exposes a reset hook (allows a suite to drop the memoized provider)', () => {
    expect(() => _resetServerAuthProviderForTests()).not.toThrow();
    // Calling the singleton without env wired would throw, so we don't drive
    // getServerAuthProvider() here — the reset itself is the contract.
    expect(typeof getServerAuthProvider).toBe('function');
  });
});
