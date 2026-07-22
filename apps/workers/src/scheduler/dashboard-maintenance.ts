/**
 * M08 Step 3 — periodic dashboard-refresh maintenance (scheduler cadence).
 *
 * The dashboard read-model recomputes reactively when its inputs change
 * (interview_readiness on a completed interview; opportunity_quality /
 * recruiter_engagement on a new application) via the M04 change hooks the API
 * layer wires. This module adds the SCHEDULER'S maintenance cadence: once per
 * cadence tick, every user whose most-recent metric is older than the
 * staleness threshold is recomputed so freshness doesn't drift when nothing
 * else nudges it (a Green metric can go quiet for weeks; the UI should still
 * be able to say "computed 30m ago").
 *
 * Pure/DB-free: depends only on the narrow ports below. Errors on one user
 * NEVER abort the sweep — a poison user must not silently freeze everyone
 * else's dashboards.
 */
import type { PlanChangeEvent } from '@careeros/cie-planner';

/** Narrow port: list users whose newest metric is older than `olderThan`. */
export interface StaleDashboardListPort {
  listStaleUsers(input: { olderThan: Date; limit: number }): Promise<string[]>;
}

/** Narrow port: recompute + persist the dashboard for one user. */
export interface DashboardRecomputePort {
  recompute(userId: string): Promise<void>;
}

/** Narrow port: append one audit row describing the sweep's outcome. */
export interface MaintenanceAuditPort {
  append(input: {
    action: string;
    reason: string;
    traceId: string;
    userId?: string;
    target?: string;
  }): Promise<void>;
}

export interface DashboardMaintenanceDeps {
  stale: StaleDashboardListPort;
  recompute: DashboardRecomputePort;
  audit: MaintenanceAuditPort;
}

export interface DashboardMaintenanceInput {
  /** Wall-clock "now" — injected so tests are deterministic. */
  now: Date;
  /** Metrics older than this many ms are eligible for refresh. */
  stalenessMs: number;
  /** Hard ceiling on users refreshed per tick so a sweep is bounded. */
  batchLimit: number;
  /** Trace id — carried into audit. */
  traceId: string;
}

export interface DashboardMaintenanceResult {
  scanned: number;
  refreshed: number;
  failed: number;
  failures: Array<{ userId: string; error: string }>;
}

const DEFAULT_STALENESS_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_BATCH_LIMIT = 50;

/**
 * Run one maintenance sweep. Best-effort: continues past per-user failures,
 * records them in the result + audit trail, and never throws to the caller
 * (the scheduler is a background worker and a thrown error would poison the
 * queue).
 */
export async function refreshStaleDashboards(
  input: DashboardMaintenanceInput,
  deps: DashboardMaintenanceDeps,
): Promise<DashboardMaintenanceResult> {
  const olderThan = new Date(input.now.getTime() - (input.stalenessMs ?? DEFAULT_STALENESS_MS));
  const limit = input.batchLimit ?? DEFAULT_BATCH_LIMIT;
  const users = await deps.stale.listStaleUsers({ olderThan, limit });

  const failures: Array<{ userId: string; error: string }> = [];
  let refreshed = 0;
  for (const userId of users) {
    try {
      await deps.recompute.recompute(userId);
      refreshed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ userId, error: message });
      await deps.audit
        .append({
          action: 'scheduler.dashboard_maintenance.user_failed',
          reason: `Dashboard refresh failed for user: ${message}`,
          traceId: input.traceId,
          userId,
        })
        .catch(() => {});
    }
  }

  await deps.audit
    .append({
      action: 'scheduler.dashboard_maintenance.sweep',
      reason: `scanned=${users.length} refreshed=${refreshed} failed=${failures.length} olderThan=${olderThan.toISOString()}`,
      traceId: input.traceId,
    })
    .catch(() => {});

  return { scanned: users.length, refreshed, failed: failures.length, failures };
}

// re-export the change type so app-side adapters can stay decoupled.
export type { PlanChangeEvent };

export const DASHBOARD_MAINTENANCE_DEFAULTS = {
  stalenessMs: DEFAULT_STALENESS_MS,
  batchLimit: DEFAULT_BATCH_LIMIT,
} as const;