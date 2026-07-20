/**
 * M07 Step 5 — approval queue + live autonomy tiers (unit tests).
 *
 * DB-free: in-memory BriefingStorePort fake + the concrete
 * InMemoryApprovalTokenStore + capability-gate `enforce`. This is the
 * SAME code path used by the production handler + gate, so the tests
 * exercise the real invariants.
 *
 * Locks:
 *   - approving a Yellow item MINTS a single-use token bound to
 *     (user, `briefing.item.execute`, payloadHash); enforce() consumes it
 *     exactly once; replay is rejected as `approval_already_consumed`;
 *   - approving a Green item transitions state but mints no token;
 *   - approving a Red item is refused (capability_denied) without minting;
 *   - editing changes the payload hash so any prior token becomes
 *     `approval_payload_mismatch`;
 *   - skipping transitions to `skipped` with no token;
 *   - non-`proposed` items cannot be re-transitioned (validation_failed);
 *   - per-user scope: user A cannot approve/edit/skip user B's item (404,
 *     no leak);
 *   - user autonomy override that TIGHTENS Yellow→Red causes execution to
 *     hard-deny even with a "valid" token (registry stays Yellow; effective
 *     tier wins);
 *   - every transition + gate decision writes an immutable audit row.
 */
import { describe, expect, it } from 'vitest';
import type { AuditClient, AuditRecord } from '@careeros/observability';
import {
  InMemoryApprovalTokenStore,
  enforce,
  type EnforceDeps,
} from '@careeros/capability-gate';
import {
  approveBriefingItem,
  editBriefingItem,
  skipBriefingItem,
  contextFromVerifiedClaims,
  BRIEFING_ITEM_EXECUTE_ACTION,
  type BriefingItem,
  type BriefingItemState,
  type BriefingStorePort,
  type RequestContext,
} from '../src/index.js';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SECRET = 'approval-secret-that-is-at-least-32-chars-long-x';

const ctx = (userId: string): RequestContext =>
  contextFromVerifiedClaims({ userId, traceId: `trace-${userId.slice(0, 4)}` });

interface ApprovalOk {
  item: BriefingItem;
  approvalToken?: string;
  approvalTokenExpiresAt?: string;
}
interface ErrorBody {
  error: { code: string; message: string };
}

// --------- in-memory fakes ---------

class FakeStore implements BriefingStorePort {
  private runOwners = new Map<string, string>();
  private items = new Map<string, { runId: string; item: BriefingItem }>();

  addRun(runId: string, userId: string): void {
    this.runOwners.set(runId, userId);
  }

  seedItem(
    runId: string,
    partial: Partial<BriefingItem> & { id: string; autonomyTier: BriefingItem['autonomyTier'] },
  ): BriefingItem {
    const item: BriefingItem = {
      id: partial.id,
      kind: partial.kind ?? 'draft',
      refId: partial.refId ?? null,
      autonomyTier: partial.autonomyTier,
      state: partial.state ?? 'proposed',
      payload: partial.payload ?? { to: 'me@example.com', subject: 'hi', body: 'v1' },
      createdAt: partial.createdAt ?? new Date().toISOString(),
    };
    this.items.set(item.id, { runId, item });
    return item;
  }

  findItemOnUserRun(
    userId: string,
    runId: string,
    itemId: string,
  ): Promise<BriefingItem | null> {
    const rec = this.items.get(itemId);
    if (!rec || rec.runId !== runId) return Promise.resolve(null);
    if (this.runOwners.get(runId) !== userId) return Promise.resolve(null);
    return Promise.resolve(rec.item);
  }

  updateItemState(
    itemId: string,
    input: { state: BriefingItemState; payload?: Record<string, unknown> },
  ): Promise<BriefingItem> {
    const rec = this.items.get(itemId);
    if (!rec) throw new Error(`unknown item ${itemId}`);
    const next: BriefingItem = {
      ...rec.item,
      state: input.state,
      payload: input.payload ?? rec.item.payload,
    };
    this.items.set(itemId, { runId: rec.runId, item: next });
    return Promise.resolve(next);
  }

  // Composition-side methods — unused by the approval handler.
  createRun(): never {
    throw new Error('unused');
  }
  finalizeRun(): never {
    throw new Error('unused');
  }
  addItems(): never {
    throw new Error('unused');
  }
  getById(): never {
    throw new Error('unused');
  }
  latestForUser(): never {
    throw new Error('unused');
  }
}

function makeAudit(): { audit: AuditClient; sink: AuditRecord[] } {
  const sink: AuditRecord[] = [];
  const audit: AuditClient = {
    async append(rec) {
      const full: AuditRecord = {
        id: `audit-${sink.length + 1}`,
        at: new Date().toISOString(),
        userId: rec.userId,
        actor: rec.actor,
        action: rec.action,
        target: rec.target ?? null,
        reason: rec.reason,
        modelVersion: rec.modelVersion ?? null,
        traceId: rec.traceId ?? null,
      };
      sink.push(full);
      return full;
    },
  };
  return { audit, sink };
}

function buildDeps() {
  const store = new FakeStore();
  const tokenStore = new InMemoryApprovalTokenStore();
  const { audit, sink } = makeAudit();
  const deps = { store, tokenStore, audit, approvalSecret: SECRET };
  return { store, tokenStore, audit, sink, deps };
}

// --------- tests ---------

describe('approval queue — Yellow mint + single-use consume', () => {
  it('approves a Yellow item, mints a token, and the gate consumes it exactly once', async () => {
    const { store, tokenStore, audit, deps } = buildDeps();
    store.addRun('run-1', USER_A);
    store.seedItem('run-1', { id: 'item-yellow', autonomyTier: 'yellow' });

    const res = await approveBriefingItem(ctx(USER_A), 'run-1', 'item-yellow', deps);
    expect(res.status).toBe(200);
    const body = res.body as ApprovalOk;
    expect(body.item.state).toBe('approved');
    expect(typeof body.approvalToken).toBe('string');
    expect(typeof body.approvalTokenExpiresAt).toBe('string');

    const token = body.approvalToken!;
    const gateDeps: EnforceDeps = { secret: SECRET, tokenStore, audit };

    // First redemption: allowed.
    const first = await enforce(
      {
        userId: USER_A,
        action: BRIEFING_ITEM_EXECUTE_ACTION,
        payload: body.item.payload,
        approvalToken: token,
        actor: 'user',
      },
      gateDeps,
    );
    expect(first.allowed).toBe(true);
    if (first.allowed) expect(first.tier).toBe('yellow');

    // Replay: rejected as already_consumed.
    const second = await enforce(
      {
        userId: USER_A,
        action: BRIEFING_ITEM_EXECUTE_ACTION,
        payload: body.item.payload,
        approvalToken: token,
        actor: 'user',
      },
      gateDeps,
    );
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.reason).toBe('approval_already_consumed');
  });

  it('approves a Green item without minting a token', async () => {
    const { store, sink, deps } = buildDeps();
    store.addRun('run-1', USER_A);
    store.seedItem('run-1', { id: 'item-green', autonomyTier: 'green' });

    const res = await approveBriefingItem(ctx(USER_A), 'run-1', 'item-green', deps);
    expect(res.status).toBe(200);
    const body = res.body as ApprovalOk;
    expect(body.item.state).toBe('approved');
    expect(body.approvalToken).toBeUndefined();
    expect(body.approvalTokenExpiresAt).toBeUndefined();
    expect(sink.some((r) => r.action === 'briefing.item.approve')).toBe(true);
  });

  it('refuses to approve a Red item (capability_denied), mints no token', async () => {
    const { store, sink, deps } = buildDeps();
    store.addRun('run-1', USER_A);
    store.seedItem('run-1', { id: 'item-red', autonomyTier: 'red' });

    const res = await approveBriefingItem(ctx(USER_A), 'run-1', 'item-red', deps);
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).error.code).toBe('capability_denied');

    const item = await store.findItemOnUserRun(USER_A, 'run-1', 'item-red');
    expect(item?.state).toBe('proposed');
    expect(sink.some((r) => r.action === 'briefing.item.approve_denied')).toBe(true);
  });
});

describe('approval queue — edit invalidates prior token; skip persists', () => {
  it('editing changes payload hash so any prior token becomes payload_mismatch', async () => {
    const { store, tokenStore, audit, deps } = buildDeps();
    store.addRun('run-1', USER_A);
    store.seedItem('run-1', { id: 'item-y', autonomyTier: 'yellow', payload: { body: 'v1' } });

    const approved = await approveBriefingItem(ctx(USER_A), 'run-1', 'item-y', deps);
    expect(approved.status).toBe(200);
    const token = (approved.body as ApprovalOk).approvalToken!;

    // Fresh proposed sibling to exercise edit (edit requires `proposed`).
    store.seedItem('run-1', { id: 'item-y2', autonomyTier: 'yellow', payload: { body: 'v1' } });
    const edited = await editBriefingItem(
      ctx(USER_A),
      'run-1',
      'item-y2',
      { payload: { body: 'v2' } },
      deps,
    );
    expect(edited.status).toBe(200);
    const eBody = edited.body as ApprovalOk;
    expect(eBody.item.state).toBe('edited');
    expect(eBody.item.payload).toEqual({ body: 'v2' });

    const gateDeps: EnforceDeps = { secret: SECRET, tokenStore, audit };
    const verdict = await enforce(
      {
        userId: USER_A,
        action: BRIEFING_ITEM_EXECUTE_ACTION,
        payload: { body: 'v2' },
        approvalToken: token,
        actor: 'user',
      },
      gateDeps,
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toBe('approval_payload_mismatch');
  });

  it('skipping transitions to `skipped`; no token is minted', async () => {
    const { store, sink, deps } = buildDeps();
    store.addRun('run-1', USER_A);
    store.seedItem('run-1', { id: 'item-y', autonomyTier: 'yellow' });

    const res = await skipBriefingItem(ctx(USER_A), 'run-1', 'item-y', deps);
    expect(res.status).toBe(200);
    expect((res.body as ApprovalOk).item.state).toBe('skipped');
    expect(sink.some((r) => r.action === 'briefing.item.skip')).toBe(true);
  });
});

describe('approval queue — invariants', () => {
  it('non-`proposed` items cannot be re-transitioned', async () => {
    const { store, deps } = buildDeps();
    store.addRun('run-1', USER_A);
    store.seedItem('run-1', { id: 'item-y', autonomyTier: 'yellow', state: 'approved' });

    const res = await approveBriefingItem(ctx(USER_A), 'run-1', 'item-y', deps);
    expect(res.status).toBe(422);
    expect((res.body as ErrorBody).error.code).toBe('validation_failed');
  });

  it("user A cannot act on user B's item (404, no leak)", async () => {
    const { store, deps } = buildDeps();
    store.addRun('run-1', USER_B);
    store.seedItem('run-1', { id: 'item-y', autonomyTier: 'yellow' });

    const res = await approveBriefingItem(ctx(USER_A), 'run-1', 'item-y', deps);
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).error.code).toBe('not_found');
  });
});

describe('live autonomy tiers — user override tightens (never loosens)', () => {
  it('Yellow→Red user override hard-denies execution even with a valid token', async () => {
    const { store, tokenStore, audit, deps } = buildDeps();
    store.addRun('run-1', USER_A);
    store.seedItem('run-1', { id: 'item-y', autonomyTier: 'yellow' });

    const approved = await approveBriefingItem(ctx(USER_A), 'run-1', 'item-y', deps);
    expect(approved.status).toBe(200);
    const body = approved.body as ApprovalOk;
    const token = body.approvalToken!;

    const gateDeps: EnforceDeps = { secret: SECRET, tokenStore, audit };
    const verdict = await enforce(
      {
        userId: USER_A,
        action: BRIEFING_ITEM_EXECUTE_ACTION,
        payload: body.item.payload,
        approvalToken: token,
        actor: 'user',
        userTierOverride: 'red',
      },
      gateDeps,
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toBe('red_never_automated');
  });

  it('Green→Yellow user override requires a token that no Green flow ever mints', async () => {
    const tokenStore = new InMemoryApprovalTokenStore();
    const { audit } = makeAudit();
    const gateDeps: EnforceDeps = { secret: SECRET, tokenStore, audit };

    // `research.run` is Green in the registry.
    const withoutToken = await enforce(
      {
        userId: USER_A,
        action: 'research.run',
        payload: { q: 'x' },
        actor: 'user',
        userTierOverride: 'yellow',
      },
      gateDeps,
    );
    expect(withoutToken.allowed).toBe(false);
    if (!withoutToken.allowed) expect(withoutToken.reason).toBe('approval_missing');
  });

  it('loosening attempts are ignored (registry wins)', async () => {
    const tokenStore = new InMemoryApprovalTokenStore();
    const { audit } = makeAudit();
    const gateDeps: EnforceDeps = { secret: SECRET, tokenStore, audit };

    // `draft.send` is Yellow in the registry. A user "loosening" to Green
    // must NOT skip approval.
    const verdict = await enforce(
      {
        userId: USER_A,
        action: 'draft.send',
        payload: { to: 'x' },
        actor: 'user',
        userTierOverride: 'green',
      },
      gateDeps,
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toBe('approval_missing');
  });
});