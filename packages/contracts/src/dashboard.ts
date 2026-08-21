import { z } from 'zod';

/** The real A1.6 metric vocabulary produced by @careeros/cie-metrics. */
export const dashboardMetricKeySchema = z.enum([
  'career_momentum',
  'interview_readiness',
  'skill_momentum',
  'market_positioning',
  'salary_trajectory',
  'opportunity_quality',
  'networking_strength',
  'recruiter_engagement',
  'portfolio_completeness',
  'strategic_recommendations',
]);
export type DashboardMetricKey = z.infer<typeof dashboardMetricKeySchema>;

export const dashboardMetricStatusSchema = z.enum(['ok', 'insufficient_data']);
export type DashboardMetricStatus = z.infer<typeof dashboardMetricStatusSchema>;

export const dashboardMetricTrendSchema = z.enum(['rising', 'flat', 'declining']);
export type DashboardMetricTrend = z.infer<typeof dashboardMetricTrendSchema>;

const profileFactMetricEvidenceRefSchema = z
  .object({
    kind: z.literal('profile_fact'),
    id: z.string().trim().min(1),
  })
  .strict();

const graphNodeMetricEvidenceRefSchema = z
  .object({
    kind: z.literal('graph_node'),
    id: z.string().trim().min(1),
  })
  .strict();

const researchFindingMetricEvidenceRefSchema = z
  .object({
    kind: z.literal('research_finding'),
    id: z.string().trim().min(1),
  })
  .strict();

const planActionMetricEvidenceRefSchema = z
  .object({
    kind: z.literal('plan_action'),
    id: z.string().trim().min(1),
  })
  .strict();

/**
 * A typed, resolvable reference into one of the four real source collections
 * admitted by the dashboard composer's evidence allow-list.
 */
export const dashboardMetricEvidenceRefSchema = z.discriminatedUnion('kind', [
  profileFactMetricEvidenceRefSchema,
  graphNodeMetricEvidenceRefSchema,
  researchFindingMetricEvidenceRefSchema,
  planActionMetricEvidenceRefSchema,
]);
export type DashboardMetricEvidenceRef = z.infer<typeof dashboardMetricEvidenceRefSchema>;

export const dashboardLinkedActionSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1).nullable(),
  })
  .strict();
export type DashboardLinkedAction = z.infer<typeof dashboardLinkedActionSchema>;

export const dashboardMetricFreshnessSchema = z
  .object({ computedAt: z.string().datetime() })
  .strict();
export type DashboardMetricFreshness = z.infer<typeof dashboardMetricFreshnessSchema>;

const dashboardMetricBaseSchema = z.object({
  metric: dashboardMetricKeySchema,
  trend: dashboardMetricTrendSchema,
  explanation: z.string().trim().min(1),
  evidenceRefs: z.array(dashboardMetricEvidenceRefSchema),
  linkedAction: dashboardLinkedActionSchema.nullable(),
  /** The backend-computed calibrated confidence. Never synthesized at the HTTP boundary. */
  confidence: z.number().min(0).max(1),
  modelVersion: z.string().trim().min(1),
  freshness: dashboardMetricFreshnessSchema,
});

const populatedDashboardMetricSchema = dashboardMetricBaseSchema
  .extend({
    status: z.literal('ok'),
    value: z.number().min(0).max(100),
  })
  .strict();

const insufficientDashboardMetricSchema = dashboardMetricBaseSchema
  .extend({
    status: z.literal('insufficient_data'),
    value: z.null(),
    confidence: z.number().min(0).max(0.5),
  })
  .strict();

/**
 * One scored dashboard inference. Populated values retain calibrated confidence;
 * thin evidence is represented by a null value and confidence no greater than 0.5.
 */
export const dashboardMetricSchema = z.discriminatedUnion('status', [
  populatedDashboardMetricSchema,
  insufficientDashboardMetricSchema,
]);
export type DashboardMetric = z.infer<typeof dashboardMetricSchema>;

export const dashboardListFreshnessSchema = z
  .object({
    generatedAt: z.string().datetime(),
    oldestComputedAt: z.string().datetime().nullable(),
  })
  .strict();

/** GET /v1/cie/dashboards. */
export const dashboardListResponseSchema = z
  .object({
    metrics: z.array(dashboardMetricSchema),
    freshness: dashboardListFreshnessSchema,
    modelVersion: z.string().trim().min(1),
  })
  .strict();
export type DashboardListResponse = z.infer<typeof dashboardListResponseSchema>;

/** A metric evidence reference resolved to human-readable source text. */
export const dashboardResolvedEvidenceSchema = z.discriminatedUnion('kind', [
  profileFactMetricEvidenceRefSchema.extend({ label: z.string().trim().min(1) }).strict(),
  graphNodeMetricEvidenceRefSchema.extend({ label: z.string().trim().min(1) }).strict(),
  researchFindingMetricEvidenceRefSchema.extend({ label: z.string().trim().min(1) }).strict(),
  planActionMetricEvidenceRefSchema.extend({ label: z.string().trim().min(1) }).strict(),
]);
export type DashboardResolvedEvidence = z.infer<typeof dashboardResolvedEvidenceSchema>;

/** GET /v1/cie/dashboards/:metric. */
const dashboardDetailBaseSchema = dashboardMetricBaseSchema.extend({
  evidence: z.array(dashboardResolvedEvidenceSchema),
});

export const dashboardDetailResponseSchema = z.discriminatedUnion('status', [
  dashboardDetailBaseSchema
    .extend({
      status: z.literal('ok'),
      value: z.number().min(0).max(100),
    })
    .strict(),
  dashboardDetailBaseSchema
    .extend({
      status: z.literal('insufficient_data'),
      value: z.null(),
      confidence: z.number().min(0).max(0.5),
    })
    .strict(),
]);
export type DashboardDetailResponse = z.infer<typeof dashboardDetailResponseSchema>;