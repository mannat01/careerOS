/**
 * ⚑ REQUIRED SECURITY TESTS — milestone-01.md / milestone-01-workorder.md task 4.
 * Yellow without token → denied; invalid/expired/payload-mismatch token → denied;
 * Red has NO allowed path; every denial writes an audit record.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CapabilityDeniedError,
  createToolCallGate,
  enforce,
  getActionTier,
  hashPayload,
  InMemoryApprovalTokenStore,
  mintApprovalToken,
  type EnforceDeps,
} from '../src/index.js';

const SECRET = 's'.repeat(32);
const OTHER_SECRET = 'o'.repeat(32);
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PAYLOAD = { draftId: 'd-1', channel: 'email' };

interface AuditEntry {
  userId: string;
  actor: string;
  action: string;
  target?: string | null;
  reason: string;
  traceId?: string | null;
}

function makeDeps(nowMs = 1_000_000): { deps: EnforceDeps; auditLog: AuditEntry[]; store: InMemoryApprovalTokenStore; clock: { now: number } } {
  const auditLog: AuditEntry[] = [];
  const store = new InMemoryApprovalTokenStore();
  const clock = { now: nowMs };
  const deps: EnforceDeps = {
    secret: SECRET,
    tokenStore: store,
    audit: { append: (r) => void auditLog.push(r as AuditEntry) },
    now: () => clock.now,
  };
  return { deps, auditLog, store, clock };
}

describe('capability-gate: Yellow actions (approve-then-act)', () => {
  let ctx: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    ctx = makeDeps();
  });

  it('DENIES a Yellow action without a token, and audits the denial', async () => {
    const result = await enforce(
      { userId: USER_A, action: 'draft.send', payload: PAYLOAD },
      ctx.deps,
    );
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('unreachable');
    expect(result.code).toBe('capability_denied');
    expect(result.reason).toBe('approval_missing');
    expect(ctx.auditLog).toHaveLength(1);
    expect(ctx.auditLog[0]?.action).toBe('capability_gate.denied');
    expect(ctx.auditLog[0]?.userId).toBe(USER_A);
  });

  it('DENIES a garbage/forged token', async () => {
    for (const bad of ['not-a-token', 'a.b.c', `${'0'.repeat(36)}.999999.${'f'.repeat(64)}`]) {
      const result = await enforce(
        { userId: USER_A, action: 'draft.send', payload: PAYLOAD, approvalToken: bad },
        ctx.deps,
      );
      expect(result.allowed).toBe(false);
    }
  });

  it('DENIES a token signed with the wrong secret', async () => {
    const forged = await mintApprovalToken({
      userId: USER_A, action: 'draft.send', payload: PAYLOAD,
      ttlMs: 60_000, secret: OTHER_SECRET, store: ctx.store, now: () => ctx.clock.now,
    });
    const result = await enforce(
      { userId: USER_A, action: 'draft.send', payload: PAYLOAD, approvalToken: forged },
      ctx.deps,
    );
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('unreachable');
    expect(result.reason).toBe('approval_bad_signature');
  });

  it('DENIES an expired token', async () => {
    const token = await mintApprovalToken({
      userId: USER_A, action: 'draft.send', payload: PAYLOAD,
      ttlMs: 60_000, secret: SECRET, store: ctx.store, now: () => ctx.clock.now,
    });
    ctx.clock.now += 60_001; // past expiry
    const result = await enforce(
      { userId: USER_A, action: 'draft.send', payload: PAYLOAD, approvalToken: token },
      ctx.deps,
    );
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('unreachable');
    expect(result.reason).toBe('approval_expired');
  });

  it('DENIES when the payload differs from the approved payload (payload binding)', async () => {
    const token = await mintApprovalToken({
      userId: USER_A, action: 'draft.send', payload: PAYLOAD,
      ttlMs: 60_000, secret: SECRET, store: ctx.store, now: () => ctx.clock.now,
    });
    const tampered = { ...PAYLOAD, draftId: 'd-666' };
    const result = await enforce(
      { userId: USER_A, action: 'draft.send', payload: tampered, approvalToken: token },
      ctx.deps,
    );
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('unreachable');
    expect(result.reason).toBe('approval_payload_mismatch');
  });

  it("DENIES another user's token (user binding)", async () => {
    const token = await mintApprovalToken({
      userId: USER_B, action: 'draft.send', payload: PAYLOAD,
      ttlMs: 60_000, secret: SECRET, store: ctx.store, now: () => ctx.clock.now,
    });
    const result = await enforce(
      { userId: USER_A, action: 'draft.send', payload: PAYLOAD, approvalToken: token },
      ctx.deps,
    );
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('unreachable');
    expect(result.reason).toBe('approval_wrong_user');
  });

  it('DENIES a token minted for a different action (action binding)', async () => {
    const token = await mintApprovalToken({
      userId: USER_A, action: 'me.delete', payload: PAYLOAD,
      ttlMs: 60_000, secret: SECRET, store: ctx.store, now: () => ctx.clock.now,
    });
    const result = await enforce(
      { userId: USER_A, action: 'draft.send', payload: PAYLOAD, approvalToken: token },
      ctx.deps,
    );
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('unreachable');
    expect(result.reason).toBe('approval_wrong_action');
  });

  it('ALLOWS a valid token exactly ONCE — replay is denied (single-use)', async () => {
    const token = await mintApprovalToken({
      userId: USER_A, action: 'draft.send', payload: PAYLOAD,
      ttlMs: 60_000, secret: SECRET, store: ctx.store, now: () => ctx.clock.now,
    });
    const first = await enforce(
      { userId: USER_A, action: 'draft.send', payload: PAYLOAD, approvalToken: token },
      ctx.deps,
    );
    expect(first.allowed).toBe(true);

    const replay = await enforce(
      { userId: USER_A, action: 'draft.send', payload: PAYLOAD, approvalToken: token },
      ctx.deps,
    );
    expect(replay.allowed).toBe(false);
    if (replay.allowed) throw new Error('unreachable');
    expect(replay.reason).toBe('approval_already_consumed');

    // Both decisions audited.
    const actions = ctx.auditLog.map((e) => e.action);
    expect(actions).toEqual(['capability_gate.allowed', 'capability_gate.denied']);
  });
});

describe('capability-gate: Red actions (never automated)', () => {
  it('DENIES a Red action even WITH a token minted for it — no allowed path exists', async () => {
    const ctx = makeDeps();
    const token = await mintApprovalToken({
      userId: USER_A, action: 'offer.accept', payload: PAYLOAD,
      ttlMs: 60_000, secret: SECRET, store: ctx.store, now: () => ctx.clock.now,
    });
    for (const approvalToken of [undefined, token]) {
      const result = await enforce(
        { userId: USER_A, action: 'offer.accept', payload: PAYLOAD, approvalToken },
        ctx.deps,
      );
      expect(result.allowed).toBe(false);
      if (result.allowed) throw new Error('unreachable');
      expect(result.reason).toBe('red_never_automated');
    }
    expect(ctx.auditLog.every((e) => e.action === 'capability_gate.denied')).toBe(true);
  });

  it('every Red action in the registry is denied unconditionally', async () => {
    const ctx = makeDeps();
    const redActions = ['account.third_party_auth', 'offer.accept', 'offer.decline', 'legal_financial.irreversible'];
    for (const action of redActions) {
      expect(getActionTier(action)).toBe('red');
      const result = await enforce({ userId: USER_A, action, payload: {} }, ctx.deps);
      expect(result.allowed).toBe(false);
    }
  });
});

describe('capability-gate: fail-closed + Green + worker wrapper', () => {
  it('DENIES an action not in the registry (fail closed)', async () => {
    const ctx = makeDeps();
    const result = await enforce(
      { userId: USER_A, action: 'totally.new.action', payload: {} },
      ctx.deps,
    );
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('unreachable');
    expect(result.reason).toBe('unknown_action');
  });

  it('ALLOWS Green actions without a token and audits the allow', async () => {
    const ctx = makeDeps();
    const result = await enforce(
      { userId: USER_A, action: 'opportunity.ingest', payload: { source: 'greenhouse' } },
      ctx.deps,
    );
    expect(result).toEqual({ allowed: true, tier: 'green' });
    expect(ctx.auditLog[0]?.action).toBe('capability_gate.allowed');
  });

  it('worker tool-call wrapper NEVER executes the side effect on a denied path', async () => {
    const ctx = makeDeps();
    const gated = createToolCallGate(ctx.deps);
    let executed = 0;
    await expect(
      gated({ userId: USER_A, action: 'draft.send', payload: PAYLOAD }, () => {
        executed += 1;
        return 'sent';
      }),
    ).rejects.toBeInstanceOf(CapabilityDeniedError);
    expect(executed).toBe(0);
  });

  it('hashPayload is canonical: key order does not matter, values do', () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });
});
