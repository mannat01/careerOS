import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';

/**
 * M08 Step 3 — Prisma-backed store for the DashboardMetric read-model
 * (database-schema.md §cie). The apps/api handler depends on the STRUCTURAL
 * shape below (its narrow `DashboardMetricStorePort`), so @careeros/db never
 * imports apps/api.
 *
 * PER-USER by construction: every read/write is scoped by the caller's profile
 * id (resolved from `userId` at the app-side boundary), so a caller can neither
 * read nor mutate another user's metrics. Cross-user reads return null → the
 * handler surfaces 404.
 *
 * WRITE MODEL: one row per (profile, metric, computed_at). We APPEND on every
 * recompute — the endpoint reads the LATEST row per (profile, metric) via the
 * composite descending index. Old rows are kept for freshness/audit; account
 * hard-delete cascades them via the FK.
 */

// ---- structural shapes mirroring the apps/api handler port (by value, no import) ----

export type DashboardMetricStatusLike = 'ok' | 'insufficient_data';
export type DashboardMetricTrendLike = 'rising' | 'flat' | 'declining';

/** One dashboard metric to persist (input shape). */
export interface PersistDashboardMetricLike {
  metric: string;
  status: DashboardMetricStatusLike;
  /** 0-100. undefined ⇒ status='insufficient_data' (value never invented). */
  value?: number;
  trend: DashboardMetricTrendLike;
  explanation: string;
  evidenceRefs: string[];
  linkedActionId?: string | null;
  confidence: number;
  modelVersion: string;
}

/** A persisted dashboard metric row (output shape). */
export interface DashboardMetricRecordLike {
  id: string;
  metric: string;
  status: DashboardMetricStatusLike;
  value: number | null;
  trend: DashboardMetricTrendLike;
  explanation: string;
  evidenceRefs: string[];
  linkedActionId: string | null;
  confidence: number;
  modelVersion: string;
  computedAt: string;
}

/** Narrow port the apps/api handler depends on. */
export interface DashboardMetricStorePortShape {
  /**
   * APPEND-write the given metrics for the caller's profile. `computedAt` marks
   * the freshness; the endpoint reads the LATEST row per (profile, metric).
   * Returns the persisted rows in write order.
   */
  writeMetrics(
    profileId: string,
    metrics: PersistDashboardMetricLike[],
    computedAt: Date,
  ): Promise<DashboardMetricRecordLike[]>;

  /** Latest row per (profile, metric) for the caller. Ordered by metric key. */
  getLatestForProfile(profileId: string): Promise<DashboardMetricRecordLike[]>;

  /** Latest row for one (profile, metric). null when not present / not owned. */
  getLatestForMetric(
    profileId: string,
    metric: string,
  ): Promise<DashboardMetricRecordLike | null>;
}

// ---- row shape returned by Prisma queries below ----

interface MetricRow {
  id: string;
  metric: string;
  status: string;
  value: number | null;
  trend: string;
  explanation: string;
  evidenceRefs: Prisma.JsonValue;
  linkedActionId: string | null;
  confidence: number;
  modelVersion: string;
  computedAt: Date;
}

export class PrismaDashboardMetricStore implements DashboardMetricStorePortShape {
  constructor(private readonly prisma: PrismaClient) {}

  async writeMetrics(
    profileId: string,
    metrics: PersistDashboardMetricLike[],
    computedAt: Date,
  ): Promise<DashboardMetricRecordLike[]> {
    const rows = metrics.map((m) => ({
      id: randomUUID(),
      profileId,
      metric: m.metric,
      status: m.status,
      value: m.status === 'ok' && typeof m.value === 'number' ? m.value : null,
      trend: m.trend,
      explanation: m.explanation,
      evidenceRefs: m.evidenceRefs,
      linkedActionId: m.linkedActionId ?? null,
      confidence: m.confidence,
      modelVersion: m.modelVersion,
      computedAt,
    }));
    if (rows.length === 0) return [];
    await this.prisma.dashboardMetric.createMany({ data: rows });
    const ids = rows.map((r) => r.id);
    const persisted = await this.prisma.dashboardMetric.findMany({ where: { id: { in: ids } } });
    // Preserve write order (createMany returns count, not rows).
    const byId = new Map(persisted.map((r) => [r.id, r]));
    return rows
      .map((r) => byId.get(r.id))
      .filter((r): r is (typeof persisted)[number] => r !== undefined)
      .map((r) => this.toRecord(r));
  }

  async getLatestForProfile(profileId: string): Promise<DashboardMetricRecordLike[]> {
    // Fetch a bounded page of the newest rows, then keep the first per metric.
    // The `(profile_id, metric, computed_at DESC)` index makes this efficient;
    // in practice one recompute pass writes ≤ 10 rows per profile so the page
    // easily covers every metric's latest.
    const rows = await this.prisma.dashboardMetric.findMany({
      where: { profileId },
      orderBy: [{ computedAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    const seen = new Set<string>();
    const latest: MetricRow[] = [];
    for (const r of rows) {
      if (seen.has(r.metric)) continue;
      seen.add(r.metric);
      latest.push(r);
    }
    latest.sort((a, b) => a.metric.localeCompare(b.metric));
    return latest.map((r) => this.toRecord(r));
  }

  async getLatestForMetric(
    profileId: string,
    metric: string,
  ): Promise<DashboardMetricRecordLike | null> {
    const row = await this.prisma.dashboardMetric.findFirst({
      where: { profileId, metric },
      orderBy: [{ computedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return row ? this.toRecord(row) : null;
  }

  private toRecord(row: MetricRow): DashboardMetricRecordLike {
    return {
      id: row.id,
      metric: row.metric,
      status: (row.status === 'insufficient_data' ? 'insufficient_data' : 'ok'),
      value: row.value,
      trend:
        row.trend === 'rising' || row.trend === 'flat' || row.trend === 'declining'
          ? row.trend
          : 'flat',
      explanation: row.explanation,
      evidenceRefs: toStringArray(row.evidenceRefs),
      linkedActionId: row.linkedActionId,
      confidence: row.confidence,
      modelVersion: row.modelVersion,
      computedAt: row.computedAt.toISOString(),
    };
  }
}

function toStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}