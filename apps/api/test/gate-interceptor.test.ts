/**
 * ⚑ Security-relevant: the API-side capability-gate wrapper around the sample
 * Yellow route (DELETE /v1/me). Denial must (a) return capability_denied, (b) write
 * an AuditLog record, (c) never invoke the handler.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryApprovalTokenStore, mintApprovalToken, type EnforceDeps } from '@careeros/capability-gate';
import { createAuditClient, InMemoryAuditSink } from '@careeros/observability';
import type { ApiError, User } from '@careeros/contracts';
import {
  contextFromVerifiedClaims,
  deleteMe,
  InMemoryUserLifecycleRepo,
  InMemoryUserRepo,
  InMemoryUserSettingsRepo,
  withCapabilityGate,
  type IdentityDeps,
} from '../src/index.js';

const SECRET = 'k'.repeat(32);
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-07-08T08:00:00.000Z');

function makeUser(id: string): User {
  return {
    id, email: 'a@example.com', authProviderId: 'clerk_a',
    subscriptionTier: 'free', status: 'active',
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  };
}

describe('capability-gate interceptor on DELETE /v1/me (Yellow)', () => {
  let auditSink: InMemoryAuditSink;
  let tokenStore: InMemoryApprovalTokenStore;
  let gateDeps: EnforceDeps;
  let identityDeps: IdentityDeps;
  let lifecycle: InMemoryUserLifecycleRepo;

  beforeEach(() => {
    auditSink = new InMemoryAuditSink();
    tokenStore = new InMemoryApprovalTokenStore();
    gateDeps = {
      secret: SECRET,
      tokenStore,
      audit: createAuditClient({ sink: auditSink, clock: () => NOW }),
      now: () => NOW.getTime(),
    };
    const users = new InMemoryUserRepo();
    users.seed(makeUser(USER_A));
    lifecycle = new InMemoryUserLifecycleRepo();
    identityDeps = { users, settings: new InMemoryUserSettingsRepo(), lifecycle, clock: () => NOW };
  });

  const route = (deps: EnforceDeps) =>
    withCapabilityGate<{ confirm: boolean }, { deleted: true }>('me.delete', deps, (ctx) =>
      deleteMe(ctx, identityDeps),
    );

  it('WITHOUT a token: 403 capability_denied, audited, handler never runs', async () => {
    const ctx = contextFromVerifiedClaims({ userId: USER_A, traceId: 'trace-1', headers: {} });
    const res = await route(gateDeps)(ctx, { confirm: true });

    expect(res.status).toBe(403);
    const body = res.body as ApiError;
    expect(body.error.code).toBe('capability_denied');
    expect(body.error.traceId).toBe('trace-1');

    expect(lifecycle.deleted).toHaveLength(0); // side effect never happened
    const audit = auditSink.records();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      userId: USER_A,
      action: 'capability_gate.denied',
      target: 'me.delete',
      traceId: 'trace-1',
    });
  });

  it('WITH an invalid token: denied and audited', async () => {
    const ctx = contextFromVerifiedClaims({
      userId: USER_A, traceId: 'trace-2',
      headers: { 'x-approval-token': 'garbage.12345.deadbeef' },
    });
    const res = await route(gateDeps)(ctx, { confirm: true });
    expect(res.status).toBe(403);
    expect((res.body as ApiError).error.code).toBe('capability_denied');
    expect(lifecycle.deleted).toHaveLength(0);
    expect(auditSink.records()[0]?.action).toBe('capability_gate.denied');
  });

  it('WITH a token bound to a DIFFERENT payload: denied (payload binding)', async () => {
    const token = await mintApprovalToken({
      userId: USER_A, action: 'me.delete', payload: { confirm: false },
      ttlMs: 60_000, secret: SECRET, store: tokenStore, now: () => NOW.getTime(),
    });
    const ctx = contextFromVerifiedClaims({
      userId: USER_A, traceId: 'trace-3', headers: { 'x-approval-token': token },
    });
    const res = await route(gateDeps)(ctx, { confirm: true });
    expect(res.status).toBe(403);
    expect(lifecycle.deleted).toHaveLength(0);
  });

  it('WITH a valid single-use token: handler runs once, replay denied', async () => {
    const token = await mintApprovalToken({
      userId: USER_A, action: 'me.delete', payload: { confirm: true },
      ttlMs: 60_000, secret: SECRET, store: tokenStore, now: () => NOW.getTime(),
    });
    const ctx = contextFromVerifiedClaims({
      userId: USER_A, traceId: 'trace-4', headers: { 'x-approval-token': token },
    });

    const first = await route(gateDeps)(ctx, { confirm: true });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ deleted: true });
    expect(lifecycle.deleted).toEqual([USER_A]);

    const replay = await route(gateDeps)(ctx, { confirm: true });
    expect(replay.status).toBe(403);
    expect(lifecycle.deleted).toHaveLength(1); // no second delete

    const actions = auditSink.records().map((r) => r.action);
    expect(actions).toEqual(['capability_gate.allowed', 'capability_gate.denied']);
  });

  it('a Red action wrapped by mistake still has no allowed path', async () => {
    const redRoute = withCapabilityGate<Record<string, never>, never>('offer.accept', gateDeps, () => {
      throw new Error('handler must never run for a Red action');
    });
    const ctx = contextFromVerifiedClaims({ userId: USER_A, traceId: 'trace-5', headers: {} });
    const res = await redRoute(ctx, {});
    expect(res.status).toBe(403);
    // res.body is already ApiError here (the HandlerResponse error branch) — no cast.
    expect(res.body.error.details?.['reason']).toBe('red_never_automated');
  });
});
