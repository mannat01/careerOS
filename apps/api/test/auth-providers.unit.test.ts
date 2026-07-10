import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { DevAuthProvider, ClerkAuthProvider, resolveBearerToken } from '../src/index.js';

const SECRET = 'test-secret-key-that-is-at-least-32-chars!';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('DevAuthProvider', () => {
  it('verifies a valid token', async () => {
    const provider = new DevAuthProvider(SECRET);
    const token = await DevAuthProvider.mint(USER_ID, SECRET);
    const ctx = await provider.verify(token);
    expect(ctx).not.toBeNull();
    expect(ctx!.userId).toBe(USER_ID);
    expect(ctx!.traceId).toBeDefined();
  });

  it('rejects an expired token', async () => {
    const provider = new DevAuthProvider(SECRET);
    const expired = await new SignJWT({ sub: USER_ID })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(SECRET));
    const result = await provider.verify(expired);
    expect(result).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const provider = new DevAuthProvider(SECRET);
    const wrongSecret = 'different-secret-key-that-is-32-chars-long!!';
    const token = await DevAuthProvider.mint(USER_ID, wrongSecret);
    const ctx = await provider.verify(token);
    expect(ctx).toBeNull();
  });

  it('rejects a malformed token', async () => {
    const provider = new DevAuthProvider(SECRET);
    const result = await provider.verify('not-a-jwt');
    expect(result).toBeNull();
  });

  it('rejects empty string', async () => {
    const provider = new DevAuthProvider(SECRET);
    const result = await provider.verify('');
    expect(result).toBeNull();
  });
});

describe('ClerkAuthProvider', () => {
  it('returns null (inactive without Clerk keys)', async () => {
    const provider = new ClerkAuthProvider();
    const result = await provider.verify('any-token');
    expect(result).toBeNull();
  });
});

describe('resolveBearerToken', () => {
  it('extracts Bearer token from Authorization header and verifies it', async () => {
    const provider = new DevAuthProvider(SECRET);
    const token = await DevAuthProvider.mint(USER_ID, SECRET);
    const ctx = await resolveBearerToken(`Bearer ${token}`, provider);
    expect(ctx).not.toBeNull();
    expect(ctx!.userId).toBe(USER_ID);
  });

  it('returns null for missing header', async () => {
    const provider = new DevAuthProvider(SECRET);
    const ctx = await resolveBearerToken(undefined, provider);
    expect(ctx).toBeNull();
  });

  it('returns null for malformed Authorization header', async () => {
    const provider = new DevAuthProvider(SECRET);
    const ctx = await resolveBearerToken('Basic somecreds', provider);
    expect(ctx).toBeNull();
  });

  it('returns null for empty Bearer token', async () => {
    const provider = new DevAuthProvider(SECRET);
    const ctx = await resolveBearerToken('Bearer ', provider);
    expect(ctx).toBeNull();
  });
});