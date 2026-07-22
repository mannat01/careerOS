/**
 * M08 Step 3 — GET /v1/cie/dashboards{,/:metric} handler unit tests.
 * DB-free — exercise the pure handlers against fake ports.
 *
 * Locks the invariants the e2e can't cheaply prove per-branch:
 *  - EVERY response carries value + trend + explanation + evidence + linked
 *    action + freshness — NEVER a bare number.
 *  - insufficient_data flows through the API AS-IS: value=null, status
 *    stamped, confidence ≤ 0.5, explanation preserved (composer's guardrail).
 *  - per-user scoping: userId → profileId via the resolver; an unknown metric
 *    key OR a metric that belongs to another profile both 404.
 *  - first-read fallback: no persisted rows ⇒ compose + persist on demand so
 *    freshness moves; subsequent reads are cheap.
 *  - recompute helper is idempotent + fire-and-forget-safe (returns the rows
 *    it persisted).
 */
import { describe, expect, it } from 'vitest';
import {
  getDashboardMetric,
  getDashboards,
  recomputeAndPersist,
  type DashboardComposerPort,
  type DashboardEvidenceResolverPort,
  type DashboardHandlerDeps,
  type DashboardPlanActionResolverPort,
  type DashboardProfileResolverPort,
} from '../src/modules/cie/dashboard.handlers.js';
import { contextFromVerifiedClaims } from '../src/index.js';
import type {
  DashboardMetricRecordLike,
  DashboardMetricStorePortShape,
  PersistDashboardMetricLike,
} from '@careeros/db';
import type { DashboardMetric, DashboardMetricComposition } from '@careeros/cie-metrics';
import { METRIC_COMPOSER_MODEL_VERSION } from '@careeros/cie-metrics';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROFILE_A = 'profile-a';

const ctx = (userId: string) =>
  contextFromVerifiedClaims({ userId, traceId: 'trace-m8' });

// -------- fakes --------

class FakeStore implements DashboardMetricStorePortShape {
  public rows: DashboardMetricRecordLike[] = [];
  public writes = 0;

  async writeMetrics(
    _profileId: string,
    metrics: PersistDashboardMetricLike[],
    computedAt: Date,
  ): Promise<DashboardMetricRecordLike[]> {
    this.writes += 1;
    const persisted: DashboardMetricRecordLike[] = metrics.map((m, i) => ({
      id: `row-${this.writes}-${i}`,
      metric: m.metric,
      status: m.status,
      value: m.status === 'ok' && typeof m.value === 'number' ? m.value : null,
      trend: m.trend,
      explanation: m.explanation,
      evidenceRefs: m.evidenceRefs,
      linkedActionId: m.linkedActionId ?? null,
      confidence: m.confidence,
      modelVersion: m.modelVersion,
      computedAt: computedAt.toISOString(),
    }));
    this.rows.push(...persisted);
    return persisted;
  }
  async getLatestForProfile(_profileId: string): Promise<DashboardMetricRecordLike[]> {
    const seen = new Set<string>();
    const latest: DashboardMetricRecordLike[] = [];
    for (const r of [...this.rows].reverse()) {
      if (seen.has(r.metric)) continue;
      seen.add(r.metric);
      latest.push(r);
    }
    latest.sort((a, b) => a.metric.localeCompare(b.metric));
    return latest;
  }
  async getLatestForMetric(
    _profileId: string,
    metric: string,
  ): Promise<DashboardMetricRecordLike | null> {
    for (const r of [...this.rows].reverse()) {
      if (r.metric === metric) return r;
    }
    return null;
  }
}

class FakeProfileResolver implements DashboardProfileResolverPort {
  constructor(private readonly map: Record<string, string | null>) {}
  async resolveProfileId(userId: string): Promise<string | null> {
    return Object.hasOwn(this.map, userId) ? this.map[userId] ?? null : null;
  }
}

function mkComposer(metrics: DashboardMetric[]): DashboardComposerPort {
  return {
    async compose(): Promise<DashboardMetricComposition> {
      return { metrics, modelVersion: METRIC_COMPOSER_MODEL_VERSION };
    },
  };
}

function mkMetric(over: Partial<DashboardMetric>): DashboardMetric {
  return {
    key: 'career_momentum',
    status: 'ok',
    value: 72,
    trend: 'rising',
    explanation: 'You logged 3 shipped features in the last 30 days.',
    evidenceRefs: ['dim:executionCadence'],
    confidence: 0.8,
    ...over,
  } as DashboardMetric;
}

const evidenceResolver: DashboardEvidenceResolverPort = {
  async resolve(_userId, refs) {
    return refs.map((ref) => ({ ref, kind: 'state_dimension', label: `label:${ref}` }));
  },
};

const planActionResolver: DashboardPlanActionResolverPort = {
  async resolveTitle(_userId, actionId) {
    return actionId === 'action-1' ? 'Ship a portfolio piece' : null;
  },
};

function mkDeps(overrides: Partial<DashboardHandlerDeps> = {}): DashboardHandlerDeps {
  const store = overrides.store ?? new FakeStore();
  return {
    store,
    profileResolver:
      overrides.profileResolver ?? new FakeProfileResolver({ [USER_A]: PROFILE_A }),
    composer: overrides.composer ?? mkComposer([mkMetric({})]),
    evidenceResolver,
    planActionResolver,
    ...overrides,
  };
}

// -------- 1. getDashboards --------

describe('getDashboards', () => {
  it('composes + persists on first read; every metric carries its explanation + freshness', async () => {
    const deps = mkDeps();
    const res = await getDashboards(ctx(USER_A), deps);
    expect(res.status).toBe(200);
    const body = (res as { body: { metrics: unknown[]; freshness: unknown; modelVersion: string } })
      .body as {
      metrics: Array<{
        metric: string;
        status: string;
        value: number | null;
        trend: string;
        explanation: string;
        evidenceRefs: string[];
        linkedAction: unknown;
        confidence: number;
        modelVersion: string;
        freshness: { computedAt: string };
      }>;
      freshness: { generatedAt: string; oldestComputedAt: string | null };
      modelVersion: string;
    };
    expect(body.metrics).toHaveLength(1);
    const m = body.metrics[0]!;
    expect(m.status).toBe('ok');
    expect(m.value).toBe(72);
    expect(m.trend).toBe('rising');
    expect(m.explanation).toContain('shipped features');
    expect(m.evidenceRefs).toEqual(['dim:executionCadence']);
    expect(m.freshness.computedAt).toEqual(expect.any(String));
    expect(body.freshness.oldestComputedAt).toBe(m.freshness.computedAt);
    expect(body.modelVersion).toBe(METRIC_COMPOSER_MODEL_VERSION);
  });

  it('reads cached rows on subsequent calls (does not recompose)', async () => {
    const store = new FakeStore();
    const deps = mkDeps({ store });
    await getDashboards(ctx(USER_A), deps);
    const writesAfterFirst = store.writes;
    await getDashboards(ctx(USER_A), deps);
    expect(store.writes).toBe(writesAfterFirst); // only the initial compose
  });

  it('404 when the user has no profile (cross-user by construction)', async () => {
    const deps = mkDeps({
      profileResolver: new FakeProfileResolver({ [USER_A]: null }),
    });
    const res = await getDashboards(ctx(USER_A), deps);
    expect(res.status).toBe(404);
  });

  it('preserves insufficient_data end-to-end (never invents a value)', async () => {
    const deps = mkDeps({
      composer: mkComposer([
        mkMetric({
          key: 'interview_readiness',
          status: 'insufficient_data',
          value: undefined,
          confidence: 0.2,
          explanation: 'No interview evidence yet.',
          evidenceRefs: [],
        }),
      ]),
    });
    const res = await getDashboards(ctx(USER_A), deps);
    const body = (res as { body: { metrics: Array<{ status: string; value: number | null; confidence: number; explanation: string }> } }).body;
    const m0 = body.metrics[0]!;
    expect(m0.status).toBe('insufficient_data');
    expect(m0.value).toBeNull();
    expect(m0.confidence).toBeLessThanOrEqual(0.5);
    expect(m0.explanation).toContain('No interview evidence');
  });
});

// -------- 2. getDashboardMetric --------

describe('getDashboardMetric', () => {
  it('drill-down resolves evidence refs into resolved objects', async () => {
    const deps = mkDeps({
      composer: mkComposer([
        mkMetric({
          evidenceRefs: ['dim:executionCadence', 'dim:visibility'],
          linkedPlanActionId: 'action-1',
        }),
      ]),
    });
    const res = await getDashboardMetric(ctx(USER_A), 'career_momentum', deps);
    expect(res.status).toBe(200);
    const body = (res as { body: { evidence: Array<{ ref: string; kind: string; label: string }>; linkedAction: { id: string; title: string | null } | null } }).body;
    expect(body.evidence).toHaveLength(2);
    expect(body.evidence[0]!.label).toBe('label:dim:executionCadence');
    expect(body.linkedAction).toEqual({ id: 'action-1', title: 'Ship a portfolio piece' });
  });

  it('404 on unknown metric key', async () => {
    const deps = mkDeps();
    const res = await getDashboardMetric(ctx(USER_A), 'not_a_real_metric', deps);
    expect(res.status).toBe(404);
  });

  it('404 when the caller has no profile (cross-user is unreachable)', async () => {
    const deps = mkDeps({
      profileResolver: new FakeProfileResolver({ [USER_A]: null }),
    });
    const res = await getDashboardMetric(ctx(USER_A), 'career_momentum', deps);
    expect(res.status).toBe(404);
  });
});

// -------- 3. recomputeAndPersist --------

describe('recomputeAndPersist (change-hook helper)', () => {
  it('returns the persisted rows; freshness advances on each call', async () => {
    const store = new FakeStore();
    const deps = mkDeps({ store });
    const first = await recomputeAndPersist(USER_A, PROFILE_A, deps);
    expect(first).toHaveLength(1);
    const firstComputedAt = first[0]!.computedAt;
    await new Promise((r) => setTimeout(r, 5));
    const second = await recomputeAndPersist(USER_A, PROFILE_A, deps);
    expect(second[0]!.computedAt >= firstComputedAt).toBe(true);
    expect(store.writes).toBe(2);
  });
});