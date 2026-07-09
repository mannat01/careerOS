import { beforeEach, describe, expect, it } from 'vitest';
import { CONSERVATIVE_AUTONOMY_DEFAULTS, type MeResponse, type User } from '@careeros/contracts';
import {
  assertUserScope,
  contextFromVerifiedClaims,
  getMe,
  InMemoryUserLifecycleRepo,
  InMemoryUserRepo,
  InMemoryUserSettingsRepo,
  patchMeSettings,
  ScopeViolationError,
  type IdentityDeps,
} from '../src/index.js';

const NOW = new Date('2026-07-08T08:00:00.000Z');
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makeUser(id: string, email: string): User {
  return {
    id, email, authProviderId: `clerk_${id.slice(0, 8)}`,
    subscriptionTier: 'free', status: 'active',
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  };
}

describe('GET /v1/me + PATCH /v1/me/settings handlers', () => {
  let deps: IdentityDeps;
  let users: InMemoryUserRepo;

  beforeEach(() => {
    users = new InMemoryUserRepo();
    users.seed(makeUser(USER_A, 'a@example.com'));
    users.seed(makeUser(USER_B, 'b@example.com'));
    deps = {
      users,
      settings: new InMemoryUserSettingsRepo(),
      lifecycle: new InMemoryUserLifecycleRepo(),
      clock: () => NOW,
    };
  });

  const ctxA = contextFromVerifiedClaims({ userId: USER_A, traceId: 't-a' });

  it('returns the user with conservative default settings on first read', async () => {
    const res = await getMe(ctxA, deps);
    expect(res.status).toBe(200);
    const body = res.body as MeResponse;
    expect(body.user.id).toBe(USER_A);
    expect(body.settings.autonomyDefaults).toEqual(CONSERVATIVE_AUTONOMY_DEFAULTS);
    expect(body.settings.dataUseOptIns).toEqual({ training: false, crossUserIntel: false });
    expect(body.settings.briefingSchedule).toBeNull();
  });

  it('is row-scoped: user A only ever reads their own settings', async () => {
    await getMe(contextFromVerifiedClaims({ userId: USER_B, traceId: 't-b' }), deps);
    const res = await getMe(ctxA, deps);
    const body = res.body as MeResponse;
    expect(body.user.id).toBe(USER_A);
    expect(body.settings.userId).toBe(USER_A);
  });

  it('scope helper throws forbidden (without leaking ids) on cross-user access', () => {
    expect(() => assertUserScope(USER_A, USER_B)).toThrowError(ScopeViolationError);
    try {
      assertUserScope(USER_A, USER_B);
    } catch (e) {
      const err = e as ScopeViolationError;
      expect(err.apiError.error.code).toBe('forbidden');
      expect(JSON.stringify(err.apiError)).not.toContain(USER_B);
    }
  });

  it('returns not_found for an unknown user', async () => {
    const res = await getMe(contextFromVerifiedClaims({ userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', traceId: 't' }), deps);
    expect(res.status).toBe(404);
  });

  it('PATCH updates settings and merges partial autonomy overrides', async () => {
    await getMe(ctxA, deps);
    const res = await patchMeSettings(ctxA, {
      autonomyDefaults: { 'resume.tailor': 'yellow' },
      dataUseOptIns: { training: true },
    }, deps);
    expect(res.status).toBe(200);
    const body = res.body as Awaited<ReturnType<InMemoryUserSettingsRepo['findByUserId']>>;
    expect(body?.autonomyDefaults['resume.tailor']).toBe('yellow'); // tightened
    expect(body?.autonomyDefaults['draft.send']).toBe('yellow'); // untouched
    expect(body?.dataUseOptIns).toEqual({ training: true, crossUserIntel: false });
  });

  it('PATCH rejects unknown keys and bad tiers with validation_failed (422)', async () => {
    const bad1 = await patchMeSettings(ctxA, { isAdmin: true }, deps);
    expect(bad1.status).toBe(422);
    const bad2 = await patchMeSettings(ctxA, { autonomyDefaults: { 'draft.send': 'purple' } }, deps);
    expect(bad2.status).toBe(422);
    expect((bad2.body as { error: { code: string } }).error.code).toBe('validation_failed');
  });
});
