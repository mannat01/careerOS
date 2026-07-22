/**
 * M08 Step 3 — Intelligence Dashboard endpoints (Green/read-only).
 *
 * Advisory Green: expose the caller's persisted DashboardMetric read-model
 * (per database-schema.md §cie). Every response carries the metric's
 * explanation + trend + evidence + linked action + freshness — NEVER a bare
 * number. The composer is the source of truth; this seam ONLY reads.
 *
 * Endpoints:
 *   GET /v1/cie/dashboards               — all metrics, latest per metric.
 *   GET /v1/cie/dashboards/:metric       — drill-down with resolved evidence
 *                                          + linked action + freshness.
 *
 * PER-USER by construction: `userId` flows from the verified `RequestContext`;
 * the profile-resolver maps it to the caller's own profileId. A cross-user id
 * simply is not reachable (the store scopes by profileId) — cross-user attempts
 * therefore return 404.
 *
 * insufficient_data surfaces as a first-class response — the value is null (never
 * invented), status='insufficient_data', confidence ≤ 0.5, and the explanation
 * says why the evidence was thin. That matches the composer's guardrail.
 *
 * DB-free: the handler depends on narrow ports whose Prisma adapters live in
 * @careeros/db + the composition root.
 */
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';
import type {
  DashboardMetricRecordLike,
  DashboardMetricStorePortShape,
  PersistDashboardMetricLike,
} from '@careeros/db';
import type { DashboardMetric, DashboardMetricComposition } from '@careeros/cie-metrics';
import { ALL_METRIC_KEYS, METRIC_COMPOSER_MODEL_VERSION } from '@careeros/cie-metrics';

// ---------------- ports (adapters live in bootstrap) ----------------

/** Resolve `userId` → the caller's own `profileId`. Returns null if no profile. */
export interface DashboardProfileResolverPort {
  resolveProfileId(userId: string): Promise<string | null>;
}

/** Compose the caller's dashboard on demand — used by change-hook recompute. */
export interface DashboardComposerPort {
  compose(userId: string): Promise<DashboardMetricComposition>;
}

/**
 * Optional evidence resolver — the drill-down enriches the raw `evidenceRefs`
 * ids into resolved evidence objects the UI can render. If unset the endpoint
 * returns the raw ids (still grounded — the composer already validated them
 * against the allow-list at write time).
 */
export interface DashboardEvidenceResolverPort {
  resolve(userId: string, refs: string[]): Promise<ResolvedEvidence[]>;
}

/** Optional plan-action lookup — hydrates the linkedActionId with a title. */
export interface DashboardPlanActionResolverPort {
  resolveTitle(userId: string, actionId: string): Promise<string | null>;
}

export interface DashboardHandlerDeps {
  store: DashboardMetricStorePortShape;
  profileResolver: DashboardProfileResolverPort;
  composer: DashboardComposerPort;
  evidenceResolver?: DashboardEvidenceResolverPort;
  planActionResolver?: DashboardPlanActionResolverPort;
}

// ---------------- response shapes ----------------

export interface ResolvedEvidence {
  ref: string;
  kind: string;
  label: string;
}

export interface DashboardMetricResponse {
  metric: string;
  status: 'ok' | 'insufficient_data';
  value: number | null;
  trend: 'rising' | 'flat' | 'declining';
  explanation: string;
  evidenceRefs: string[];
  linkedAction: { id: string; title: string | null } | null;
  confidence: number;
  modelVersion: string;
  freshness: { computedAt: string };
}

export interface DashboardListResponse {
  metrics: DashboardMetricResponse[];
  freshness: { generatedAt: string; oldestComputedAt: string | null };
  modelVersion: string;
}

export interface DashboardDetailResponse extends DashboardMetricResponse {
  evidence: ResolvedEvidence[];
}

// ---------------- handlers ----------------

/**
 * GET /v1/cie/dashboards
 * Return every A1.6 metric for the caller (latest row per metric). If no metric
 * has ever been computed we compose one on-demand + persist it so the caller
 * always gets a grounded response with explanation + freshness.
 */
export async function getDashboards(
  ctx: RequestContext,
  deps: DashboardHandlerDeps,
): Promise<HandlerResponse<DashboardListResponse>> {
  const profileId = await deps.profileResolver.resolveProfileId(ctx.userId);
  if (!profileId) {
    return errorResponse('not_found', 'No profile.', { traceId: ctx.traceId });
  }

  let rows = await deps.store.getLatestForProfile(profileId);
  if (rows.length === 0) {
    // First read — compose + persist so subsequent reads are cheap + fresh.
    await recomputeAndPersist(ctx.userId, profileId, deps);
    rows = await deps.store.getLatestForProfile(profileId);
  }

  const metrics: DashboardMetricResponse[] = [];
  for (const row of rows) {
    metrics.push(await enrich(ctx.userId, row, deps, { withPlan: true }));
  }

  const oldest = rows.reduce<string | null>((acc, r) => {
    if (!acc) return r.computedAt;
    return r.computedAt < acc ? r.computedAt : acc;
  }, null);

  return ok<DashboardListResponse>({
    metrics,
    freshness: {
      generatedAt: new Date().toISOString(),
      oldestComputedAt: oldest,
    },
    modelVersion: METRIC_COMPOSER_MODEL_VERSION,
  });
}

/**
 * GET /v1/cie/dashboards/:metric
 * Drill-down: resolved evidence for the caller's latest row of one metric.
 * 404 on unknown metric keys AND on cross-user access — a metric that belongs
 * to another profile is simply not reachable.
 */
export async function getDashboardMetric(
  ctx: RequestContext,
  metric: string,
  deps: DashboardHandlerDeps,
): Promise<HandlerResponse<DashboardDetailResponse>> {
  if (!(ALL_METRIC_KEYS as string[]).includes(metric)) {
    return errorResponse('not_found', `Unknown metric key: ${metric}`, {
      details: { metric },
      traceId: ctx.traceId,
    });
  }
  const profileId = await deps.profileResolver.resolveProfileId(ctx.userId);
  if (!profileId) {
    return errorResponse('not_found', 'No profile.', { traceId: ctx.traceId });
  }

  let row = await deps.store.getLatestForMetric(profileId, metric);
  if (!row) {
    await recomputeAndPersist(ctx.userId, profileId, deps);
    row = await deps.store.getLatestForMetric(profileId, metric);
  }
  if (!row) {
    return errorResponse('not_found', 'Metric not yet computed for this profile.', {
      details: { metric },
      traceId: ctx.traceId,
    });
  }

  const base = await enrich(ctx.userId, row, deps, { withPlan: true });
  const evidence = deps.evidenceResolver
    ? await deps.evidenceResolver.resolve(ctx.userId, row.evidenceRefs)
    : row.evidenceRefs.map((ref) => ({ ref, kind: 'unknown', label: ref }));

  return ok<DashboardDetailResponse>({ ...base, evidence });
}

// ---------------- recompute helper (change-hook + first-read fallback) ----------------

/**
 * Compose the caller's dashboard via the composer service and persist EVERY
 * returned metric. Used by:
 *   - first-read of `GET /v1/cie/dashboards` when no rows exist,
 *   - change hooks (a completed interview → interview_readiness; a new
 *     application → opportunity_quality/recruiter_engagement),
 *   - the scheduler's maintenance cadence (periodic refresh).
 *
 * Exported so the composition root can wire the same helper into the change
 * hooks + scheduler without re-implementing the persistence contract.
 */
export async function recomputeAndPersist(
  userId: string,
  profileId: string,
  deps: DashboardHandlerDeps,
): Promise<DashboardMetricRecordLike[]> {
  const composition = await deps.composer.compose(userId);
  const now = new Date();
  const rows: PersistDashboardMetricLike[] = composition.metrics.map((m) =>
    toPersist(m, composition.modelVersion),
  );
  return deps.store.writeMetrics(profileId, rows, now);
}

function toPersist(m: DashboardMetric, modelVersion: string | undefined): PersistDashboardMetricLike {
  const base: PersistDashboardMetricLike = {
    metric: m.key,
    status: m.status,
    trend: m.trend,
    explanation: m.explanation,
    evidenceRefs: m.evidenceRefs,
    confidence: m.confidence,
    modelVersion: modelVersion ?? METRIC_COMPOSER_MODEL_VERSION,
    linkedActionId: m.linkedPlanActionId ?? null,
  };
  if (m.status === 'ok' && typeof m.value === 'number') {
    base.value = m.value;
  }
  return base;
}

// ---------------- shared serialization ----------------

async function enrich(
  userId: string,
  row: DashboardMetricRecordLike,
  deps: DashboardHandlerDeps,
  opts: { withPlan: boolean },
): Promise<DashboardMetricResponse> {
  let linkedAction: DashboardMetricResponse['linkedAction'] = null;
  if (row.linkedActionId) {
    let title: string | null = null;
    if (opts.withPlan && deps.planActionResolver) {
      title = await deps.planActionResolver.resolveTitle(userId, row.linkedActionId);
    }
    linkedAction = { id: row.linkedActionId, title };
  }
  return {
    metric: row.metric,
    status: row.status,
    value: row.value,
    trend: row.trend,
    explanation: row.explanation,
    evidenceRefs: row.evidenceRefs,
    linkedAction,
    confidence: row.confidence,
    modelVersion: row.modelVersion,
    freshness: { computedAt: row.computedAt },
  };
}