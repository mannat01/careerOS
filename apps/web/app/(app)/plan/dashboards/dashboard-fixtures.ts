import {
  dashboardDetailResponseSchema,
  dashboardListResponseSchema,
  type DashboardDetailResponse,
  type DashboardListResponse,
  type DashboardMetric,
  type DashboardMetricKey,
} from '@careeros/contracts';

const COMPUTED_AT = '2026-08-21T12:00:00.000Z';
const MODEL_VERSION = 'metric-composer@fake-grounded';

const VALUES: Readonly<Record<DashboardMetricKey, number>> = {
  career_momentum: 72,
  interview_readiness: 64,
  skill_momentum: 81,
  market_positioning: 58,
  salary_trajectory: 69,
  opportunity_quality: 76,
  networking_strength: 47,
  recruiter_engagement: 55,
  portfolio_completeness: 88,
  strategic_recommendations: 62,
};

const METRIC_KEYS = Object.keys(VALUES) as DashboardMetricKey[];

function populatedMetric(metric: DashboardMetricKey, index: number): DashboardMetric {
  return {
    metric,
    status: 'ok',
    value: VALUES[metric],
    trend: index % 3 === 0 ? 'rising' : index % 3 === 1 ? 'flat' : 'declining',
    explanation: `Backend explanation for ${metric}.`,
    evidenceRefs: [{ kind: 'profile_fact', id: `profile-fact-${String(index + 1)}` }],
    linkedAction: index === 0 ? { id: 'action-1', title: 'Publish a portfolio case study' } : null,
    confidence: 0.61 + index * 0.03,
    modelVersion: MODEL_VERSION,
    freshness: { computedAt: COMPUTED_AT },
  };
}

export const POPULATED_DASHBOARD: DashboardListResponse = dashboardListResponseSchema.parse({
  metrics: METRIC_KEYS.map(populatedMetric),
  freshness: { generatedAt: COMPUTED_AT, oldestComputedAt: COMPUTED_AT },
  modelVersion: MODEL_VERSION,
});

export const THIN_DASHBOARD: DashboardListResponse = dashboardListResponseSchema.parse({
  ...POPULATED_DASHBOARD,
  metrics: POPULATED_DASHBOARD.metrics.map((metric) => metric.metric === 'interview_readiness'
    ? {
        ...metric,
        status: 'insufficient_data',
        value: null,
        trend: 'flat',
        explanation: 'No interview outcomes are available yet.',
        evidenceRefs: [],
        linkedAction: null,
        confidence: 0.27,
      }
    : metric),
});

export const CAREER_MOMENTUM_DETAIL: DashboardDetailResponse = dashboardDetailResponseSchema.parse({
  ...POPULATED_DASHBOARD.metrics[0],
  evidence: [{
    kind: 'profile_fact',
    id: 'profile-fact-1',
    label: 'Shipped two caller-recorded portfolio projects.',
  }],
});

export function detailFor(metric: DashboardMetric): DashboardDetailResponse {
  return dashboardDetailResponseSchema.parse({
    ...metric,
    evidence: metric.evidenceRefs.map((ref) => ({ ...ref, label: `Resolved ${ref.id}` })),
  });
}