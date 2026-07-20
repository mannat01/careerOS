/**
 * ⚑ M07 Step 5 — autonomy tiers are LIVE end-to-end.
 *
 * The gate interceptor consults the per-user autonomy resolver BEFORE
 * enforcement so a user's `UserSettings.autonomyDefaults[action]` override
 * TIGHTENS the effective tier. This test uses the sample me.export route
 * (registry: green) to prove:
 *   - default: green → runs without a token;
 *   - user override yellow → denied without a token;
 *   - approval token minted for me.export → runs once; replay denied;
 *   - user override red → denied even with a valid token (registry green,
 *     user tightens to red; red is uncallable).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryApprovalTokenStore,
  mintApprovalToken,
  type EnforceDeps,
} from '@careeros/capability-gate';
import { createAuditClient, InMemoryAuditSink } from '@careeros/observability';
import type { AutonomyTier, User, UserSettings } from '@careeros/contracts';
import {
  contextFromVerifiedClaims,
  InMemoryUserSettingsRepo,
  makeUserAutonomyResolver,
  withCapabilityGate,
  type HandlerResponse,
} from '../src/index.js';

const SECRET = 'k'.repeat(32);
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-07-20T08:00:00.000Z');

function makeSettings(overrides: Record<string, AutonomyTier>): UserSettings {
  return {
    userId: USER,
    autonomyDefaults: overrides,
    quietHours: { start: '22:00', end: '07:00', timezone: 'UTC' },
    briefingSchedule: { timezone: 'UTC', cron: '30 6 * * *' },
    sourcePrefs: {},
    dataUseOptIns: { analytics: false, marketing: false, research: false },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  } as unknown as UserSettings;
}

describe('M07 Step 5 — autonomy tiers live (per-user tightening)', () => {
  let auditSink: InMemoryAuditSink;
  let tokenStore: InMemoryApprovalTokenStore;
  let settings: InMemoryUserSettingsRepo;
  let gateDeps: EnforceDeps;

  const runExportRoute = async (
    payload: undefined,
    ctxHeaders: Record<string, string | undefined>,
  ): Promise<HandlerResponse<{ ok: true }>> => {
    const resolver = makeUserAutonomyResolver(settings);
    const gated = withCapabilityGate<undefined, { ok: true }>(
      'me.export', // registry: green
      gateDeps,
      // eslint-disable-next-line @typescript-eslint/require-await
      async () => ({ status: 200, body: { ok: true } }),
      resolver,
    );
    const ctx = contextFromVerifiedClaims({
      userId: USER,
      traceId: 'trace-1',
      headers: ctxHeaders,
    });
    return gated(ctx, payload);
  };

  beforeEach(() => {
    auditSink = new InMemoryAuditSink();
    tokenStore = new InMemoryApprovalTokenStore();
    settings = new InMemoryUserSettingsRepo();
    gateDeps = {
      secret: SECRET,
      tokenStore,
      audit: createAuditClient({ sink: auditSink, clock: () => NOW }),
      now: () => NOW.getTime(),
    };
    // seed a placeholder user (unused directly; kept for parity with production).
    void ({ id: USER } satisfies Pick<User, 'id'>);
  });

  it('no override: Green action runs without approval token', async () => {
    const res = await runExportRoute(undefined, {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(auditSink.records().at(-1)?.action).toBe('capability_gate.allowed');
  });

  it('user override yellow: Green action denied without token', async () => {
    await settings.save(makeSettings({ 'me.export': 'yellow' }));
    const res = await runExportRoute(undefined, {});
    expect(res.status).toBe(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('capability_denied');
    expect(auditSink.records().at(-1)?.action).toBe('capability_gate.denied');
  });

  it('user override yellow + valid single-use token: runs once, replay denied', async () => {
    await settings.save(makeSettings({ 'me.export': 'yellow' }));

    const token = await mintApprovalToken({
      userId: USER,
      action: 'me.export',
      payload: undefined,
      ttlMs: 60_000,
      secret: SECRET,
      store: tokenStore,
      now: () => NOW.getTime(),
    });

    const first = await runExportRoute(undefined, { 'x-approval-token': token });
    expect(first.status).toBe(200);

    const replay = await runExportRoute(undefined, { 'x-approval-token': token });
    expect(replay.status).toBe(403);

    const actions = auditSink.records().map((r) => r.action);
    expect(actions).toContain('capability_gate.allowed');
    expect(actions.filter((a) => a === 'capability_gate.denied').length).toBeGreaterThanOrEqual(1);
  });

  it('user override red: no token can enable — even a valid one', async () => {
    await settings.save(makeSettings({ 'me.export': 'red' }));

    const token = await mintApprovalToken({
      userId: USER,
      action: 'me.export',
      payload: undefined,
      ttlMs: 60_000,
      secret: SECRET,
      store: tokenStore,
      now: () => NOW.getTime(),
    });

    const res = await runExportRoute(undefined, { 'x-approval-token': token });
    expect(res.status).toBe(403);
    const errBody = res.body as unknown as { error: { details?: { reason?: string } } };
    expect(errBody.error.details?.reason).toBe('red_never_automated');
  });

  it('changing the user\'s autonomy setting flips enforcement on the very next call', async () => {
    // default: allowed
    let res = await runExportRoute(undefined, {});
    expect(res.status).toBe(200);

    // tighten to yellow → denied
    await settings.save(makeSettings({ 'me.export': 'yellow' }));
    res = await runExportRoute(undefined, {});
    expect(res.status).toBe(403);

    // relax back (delete override) → allowed again (registry green restored)
    await settings.save(makeSettings({}));
    res = await runExportRoute(undefined, {});
    expect(res.status).toBe(200);
  });
});