/**
 * M08 Step 3 — periodic dashboard-refresh maintenance tests.
 *
 * Locks the invariants the scheduler cadence relies on:
 *  - Only users whose newest metric is older than `stalenessMs` are refreshed.
 *  - A per-user recompute failure does NOT abort the sweep (poison-user
 *    isolation); the sweep records the failure in the returned result AND
 *    an audit row, then keeps going.
 *  - The sweep emits ONE summary audit row per tick.
 *  - The batch is bounded by `batchLimit`.
 */
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_MAINTENANCE_DEFAULTS,
  refreshStaleDashboards,
  type DashboardMaintenanceDeps,
  type DashboardRecomputePort,
  type MaintenanceAuditPort,
  type StaleDashboardListPort,
} from '../src/scheduler/index.js';

class FakeStale implements StaleDashboardListPort {
  public seenOlderThan: Date | null = null;
  public seenLimit = 0;
  constructor(private readonly users: string[]) {}
  async listStaleUsers(input: { olderThan: Date; limit: number }): Promise<string[]> {
    await Promise.resolve();
    this.seenOlderThan = input.olderThan;
    this.seenLimit = input.limit;
    return this.users.slice(0, input.limit);
  }
}

class FakeRecompute implements DashboardRecomputePort {
  public recomputed: string[] = [];
  constructor(private readonly failFor: Set<string> = new Set()) {}
  async recompute(userId: string): Promise<void> {
    await Promise.resolve();
    if (this.failFor.has(userId)) throw new Error(`boom:${userId}`);
    this.recomputed.push(userId);
  }
}

class FakeAudit implements MaintenanceAuditPort {
  public rows: Array<{ action: string; reason: string; userId?: string }> = [];
  async append(input: {
    action: string;
    reason: string;
    traceId: string;
    userId?: string;
    target?: string;
  }): Promise<void> {
    await Promise.resolve();
    const row: { action: string; reason: string; userId?: string } = {
      action: input.action,
      reason: input.reason,
    };
    if (input.userId !== undefined) row.userId = input.userId;
    this.rows.push(row);
  }
}

function mkDeps(users: string[], failFor: Set<string> = new Set()): {
  deps: DashboardMaintenanceDeps;
  stale: FakeStale;
  recompute: FakeRecompute;
  audit: FakeAudit;
} {
  const stale = new FakeStale(users);
  const recompute = new FakeRecompute(failFor);
  const audit = new FakeAudit();
  return { deps: { stale, recompute, audit }, stale, recompute, audit };
}

describe('refreshStaleDashboards', () => {
  it('refreshes every user the stale-list returns and audits one summary row', async () => {
    const now = new Date('2026-07-21T20:00:00.000Z');
    const { deps, stale, recompute, audit } = mkDeps(['u1', 'u2', 'u3']);

    const res = await refreshStaleDashboards(
      { now, stalenessMs: 60_000, batchLimit: 10, traceId: 't1' },
      deps,
    );

    expect(res.scanned).toBe(3);
    expect(res.refreshed).toBe(3);
    expect(res.failed).toBe(0);
    expect(recompute.recomputed).toEqual(['u1', 'u2', 'u3']);
    expect(stale.seenOlderThan?.toISOString()).toBe('2026-07-21T19:59:00.000Z');
    expect(stale.seenLimit).toBe(10);

    const sweep = audit.rows.find((r) => r.action === 'scheduler.dashboard_maintenance.sweep');
    expect(sweep).toBeDefined();
    expect(sweep!.reason).toContain('scanned=3 refreshed=3 failed=0');
  });

  it('poison user does not abort the sweep; failure is recorded per-user + in the summary', async () => {
    const now = new Date('2026-07-21T20:00:00.000Z');
    const { deps, recompute, audit } = mkDeps(['ok1', 'poison', 'ok2'], new Set(['poison']));

    const res = await refreshStaleDashboards(
      { now, stalenessMs: 60_000, batchLimit: 10, traceId: 't2' },
      deps,
    );

    expect(res.scanned).toBe(3);
    expect(res.refreshed).toBe(2);
    expect(res.failed).toBe(1);
    expect(recompute.recomputed).toEqual(['ok1', 'ok2']);

    const perUser = audit.rows.find(
      (r) => r.action === 'scheduler.dashboard_maintenance.user_failed' && r.userId === 'poison',
    );
    expect(perUser).toBeDefined();
    const sweep = audit.rows.find((r) => r.action === 'scheduler.dashboard_maintenance.sweep');
    expect(sweep!.reason).toContain('failed=1');
  });

  it('honors batchLimit', async () => {
    const now = new Date('2026-07-21T20:00:00.000Z');
    const users = Array.from({ length: 25 }, (_, i) => `u${i}`);
    const { deps, recompute } = mkDeps(users);

    const res = await refreshStaleDashboards(
      { now, stalenessMs: DASHBOARD_MAINTENANCE_DEFAULTS.stalenessMs, batchLimit: 5, traceId: 't3' },
      deps,
    );

    expect(res.scanned).toBe(5);
    expect(recompute.recomputed).toHaveLength(5);
  });
});