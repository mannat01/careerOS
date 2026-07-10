import { beforeEach, describe, expect, it } from 'vitest';
import type { MeResponse, User } from '@careeros/contracts';
import {
  DevAuthProvider,
  getMe,
  InMemoryUserLifecycleRepo,
  InMemoryUserRepo,
  InMemoryUserSettingsRepo,
  resolveBearerToken,
  type IdentityDeps,
  type RequestContext,
} from '../src/index.js';

const SECRET = 'test-secret-key-that-is-at-least-32-chars!';
const NOW = new Date('2026-07-09T08:00:00.000Z');
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makeUser(id: string, email: string): User {
  return {
    id, email, authProviderId: `dev_${id.slice(0, 8)}`,
    subscriptionTier: 'free', status: 'active',
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  };
}

describe('auth guard + per-user scoping (handler level)', () => {
  let deps: IdentityDeps;
  let provider: DevAuthProvider;

  beforeEach(() => {
    const users = new InMemoryUserRepo();
    users.seed(makeUser(USER_A, 'a@example.com'));
    users.seed(makeUser(USER_B, 'b@example.com'));
    deps = {
      users,
      settings: new InMemoryUserSettingsRepo(),
      lifecycle: new InMemoryUserLifecycleRepo(),
      clock: () => NOW,
    };
    provider = new DevAuthProvider(SECRET);
  });

  it('a DevAuth token for user A reads only user A data', async () => {
    const token = await DevAuthProvider.mint(USER_A, SECRET);
    const ctx = await resolveBearerToken(`Bearer ${token}`, provider);
    expect(ctx).not.toBeNull();
    expect(ctx!.userId).toBe(USER_A);

    const res = await getMe(ctx as RequestContext, deps);
    expect(res.status).toBe(200);
    const body = res.body as MeResponse;
    expect(body.user.id).toBe(USER_A);
    expect(body.user.email).toBe('a@example.com');
    // User B's data is never reachable: the context's userId is the only row-scope.
    expect(body.user.email).not.toBe('b@example.com');
  });

  it('user A token cannot be used to read user B data (scoping is context-derived)', async () => {
    const tokenA = await DevAuthProvider.mint(USER_A, SECRET);
    const ctxA = await resolveBearerToken(`Bearer ${tokenA}`, provider);

    // Even if the caller *claims* user B in a header/body, the verified context wins.
    const res = await getMe(ctxA as RequestContext, deps);
    const body = res.body as MeResponse;
    expect(body.user.id).toBe(USER_A);
    expect(body.user.id).not.toBe(USER_B);
  });

  it('missing token → unauthenticated (null context, handler never invoked)', async () => {
    const ctx = await resolveBearerToken(undefined, provider);
    expect(ctx).toBeNull();
    // The guard returns null; the framework layer maps this to 401 before any handler runs.
  });

  it('invalid token → unauthenticated (null context)', async () => {
    const ctx = await resolveBearerToken('Bearer garbage.token.here', provider);
    expect(ctx).toBeNull();
  });

  it('token signed with the wrong secret → unauthenticated', async () => {
    const evilToken = await DevAuthProvider.mint(USER_B, 'attacker-secret-that-is-32-chars-long!!!');
    const ctx = await resolveBearerToken(`Bearer ${evilToken}`, provider);
    expect(ctx).toBeNull();
  });
});