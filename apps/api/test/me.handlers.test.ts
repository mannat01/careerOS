import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONSERVATIVE_AUTONOMY_DEFAULTS,
  defaultUserSettings,
  type MeResponse,
  type User,
} from '@careeros/contracts';
import {
  assertUserScope,
  bootstrapMe,
  completeOnboarding,
  contextFromVerifiedClaims,
  getMe,
  InMemoryUserLifecycleRepo,
  InMemoryIdentityBootstrapRepo,
  InMemoryOnboardingCompletionRepo,
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
    onboardingCompletedAt: NOW.toISOString(),
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  };
}

describe('GET /v1/me + PATCH /v1/me/settings handlers', () => {
  let deps: IdentityDeps;
  let users: InMemoryUserRepo;
  let settings: InMemoryUserSettingsRepo;
  let completion: InMemoryOnboardingCompletionRepo;

  beforeEach(() => {
    users = new InMemoryUserRepo();
    users.seed(makeUser(USER_A, 'a@example.com'));
    users.seed(makeUser(USER_B, 'b@example.com'));
    settings = new InMemoryUserSettingsRepo();
    void settings.save(defaultUserSettings(USER_A, NOW.toISOString()));
    void settings.save(defaultUserSettings(USER_B, NOW.toISOString()));
    completion = new InMemoryOnboardingCompletionRepo(users, settings);
    deps = {
      users,
      settings,
      lifecycle: new InMemoryUserLifecycleRepo(),
      bootstrap: new InMemoryIdentityBootstrapRepo(users, settings),
      completion,
      clock: () => NOW,
    };
  });

  const ctxA = contextFromVerifiedClaims({ userId: USER_A, traceId: 't-a' });

  it('returns an existing complete user without changing onboarding', async () => {
    const res = await getMe(ctxA, deps);
    expect(res.status).toBe(200);
    const body = res.body as MeResponse;
    expect(body.user.id).toBe(USER_A);
    expect(body.settings.autonomyDefaults).toEqual(CONSERVATIVE_AUTONOMY_DEFAULTS);
    expect(body.settings.dataUseOptIns).toEqual({ training: false, crossUserIntel: false });
    expect(body.settings.briefingSchedule).toBeNull();
    expect(body.onboarding).toEqual({ status: 'complete', completedAt: NOW.toISOString() });
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

  it('first bootstrap creates one user/settings identity and second returns the same account', async () => {
    const firstRunId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const firstRun = contextFromVerifiedClaims({
      userId: firstRunId,
      traceId: 'bootstrap-1',
      provider: 'dev',
      providerSubject: firstRunId,
      email: 'first@example.com',
    });
    const first = await bootstrapMe(firstRun, undefined, deps);
    const second = await bootstrapMe(firstRun, undefined, deps);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((first.body as MeResponse).user.id).toBe(firstRunId);
    expect((second.body as MeResponse).user.id).toBe(firstRunId);
    expect((first.body as MeResponse).onboarding).toEqual({ status: 'required', completedAt: null });
    expect((await settings.findByUserId(firstRunId))?.autonomyDefaults)
      .toEqual(CONSERVATIVE_AUTONOMY_DEFAULTS);
  });

  it('bootstrap does not overwrite existing settings or complete/suspended/deleted state', async () => {
    const custom = defaultUserSettings(USER_A, NOW.toISOString());
    custom.autonomyDefaults = { 'resume.tailor': 'yellow' };
    await settings.save(custom);
    for (const status of ['active', 'suspended', 'deleted'] as const) {
      users.seed({ ...makeUser(USER_A, 'a@example.com'), status });
      const response = await bootstrapMe(ctxA, undefined, deps);
      const me = response.body as MeResponse;
      expect(me.user.status).toBe(status);
      expect(me.onboarding.status).toBe('complete');
      expect(me.settings.autonomyDefaults).toEqual({ 'resume.tailor': 'yellow' });
    }
  });

  it('body-supplied identity cannot affect ownership', async () => {
    const response = await bootstrapMe(
      ctxA,
      { userId: USER_B, providerSubject: USER_B, status: 'active' },
      deps,
    );
    expect((response.body as MeResponse).user.id).toBe(USER_A);
  });

  it('GET with a missing settings row is internal and never provisions through the read', async () => {
    const emptySettings = new InMemoryUserSettingsRepo();
    const localDeps: IdentityDeps = {
      ...deps,
      settings: emptySettings,
      bootstrap: new InMemoryIdentityBootstrapRepo(users, emptySettings),
    };
    const response = await getMe(ctxA, localDeps);
    expect(response.status).toBe(500);
    expect((response.body as { error: { code: string; traceId?: string } }).error)
      .toMatchObject({ code: 'internal', traceId: 't-a' });
    expect(await emptySettings.findByUserId(USER_A)).toBeNull();
  });

  it('database/dependency failure remains typed internal with trace id', async () => {
    const response = await getMe(ctxA, {
      ...deps,
      users: { findById: () => Promise.reject(new Error('db unavailable')) },
    });
    expect(response.status).toBe(500);
    expect((response.body as { error: { code: string; traceId?: string } }).error)
      .toMatchObject({ code: 'internal', traceId: 't-a' });
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

  it('completes only after a profile fact and emits one event across retries', async () => {
    users.seed({ ...makeUser(USER_A, 'a@example.com'), onboardingCompletedAt: null });
    const blocked = await completeOnboarding(ctxA, {}, deps);
    expect(blocked.status).toBe(409);
    expect((blocked.body as { error: { code: string; message: string } }).error)
      .toMatchObject({ code: 'conflict', message: 'Import a résumé first.' });

    completion.setHasImportedFact(USER_A);
    const first = await completeOnboarding(ctxA, {}, deps);
    const second = await completeOnboarding(ctxA, {}, deps);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((first.body as MeResponse).onboarding).toEqual({
      status: 'complete', completedAt: NOW.toISOString(),
    });
    expect((second.body as MeResponse).onboarding).toEqual((first.body as MeResponse).onboarding);
    expect(completion.events).toEqual([
      { userId: USER_A, type: 'user_decision', kind: 'onboarding_completed' },
    ]);
  });

  it('ignores body-supplied identity and rejects non-empty completion bodies', async () => {
    completion.setHasImportedFact(USER_A);
    const result = await completeOnboarding(ctxA, { userId: USER_B }, deps);
    expect(result.status).toBe(422);
    expect((await completeOnboarding(ctxA, null, deps)).status).toBe(422);
    expect(completion.events).toEqual([]);
  });
});
