import { describe, expect, it } from 'vitest';
import {
  dashboardDetailResponseSchema,
  dashboardListResponseSchema,
  dashboardMetricSchema,
} from '../src/index.js';

const COMPUTED_AT = '2026-08-21T12:00:00.000Z';

const populatedMetric = {
  metric: 'career_momentum' as const,
  status: 'ok' as const,
  value: 72,
  trend: 'rising' as const,
  explanation: 'Recent completed work and application progress support this score.',
  evidenceRefs: [
    { kind: 'profile_fact' as const, id: 'experience:exp-1' },
    { kind: 'graph_node' as const, id: 'node-skill-1' },
    { kind: 'research_finding' as const, id: 'finding-1' },
    { kind: 'plan_action' as const, id: 'action-1' },
  ],
  linkedAction: { id: 'action-1', title: 'Publish a portfolio case study' },
  confidence: 0.83,
  modelVersion: 'metric-composer@1.0.0',
  freshness: { computedAt: COMPUTED_AT },
};

describe('FM6.5-pre public dashboard contracts', () => {
  it('strictly parses a populated scored metric with typed, resolvable evidence', () => {
    expect(dashboardMetricSchema.parse(populatedMetric)).toEqual(populatedMetric);
    expect(dashboardMetricSchema.safeParse({ ...populatedMetric, confidence: 1.01 }).success).toBe(false);
    expect(dashboardMetricSchema.safeParse({ ...populatedMetric, metric: 'invented_metric' }).success).toBe(false);
    expect(dashboardMetricSchema.safeParse({
      ...populatedMetric,
      evidenceRefs: ['experience:exp-1'],
    }).success).toBe(false);
    expect(dashboardMetricSchema.safeParse({ ...populatedMetric, clientTrend: 'up' }).success).toBe(false);
  });

  it('requires an honest null value and thin confidence for insufficient data', () => {
    const thin = {
      ...populatedMetric,
      metric: 'interview_readiness' as const,
      status: 'insufficient_data' as const,
      value: null,
      trend: 'flat' as const,
      explanation: 'No interview outcomes are available yet.',
      evidenceRefs: [],
      linkedAction: null,
      confidence: 0.2,
    };
    expect(dashboardMetricSchema.parse(thin)).toEqual(thin);
    expect(dashboardMetricSchema.safeParse({ ...thin, value: 0 }).success).toBe(false);
    expect(dashboardMetricSchema.safeParse({ ...thin, confidence: 0.8 }).success).toBe(false);
    expect(dashboardMetricSchema.safeParse({ ...populatedMetric, value: null }).success).toBe(false);
  });

  it('strictly parses list freshness and a resolved detail response', () => {
    const list = {
      metrics: [populatedMetric],
      freshness: { generatedAt: COMPUTED_AT, oldestComputedAt: COMPUTED_AT },
      modelVersion: 'metric-composer@1.0.0',
    };
    expect(dashboardListResponseSchema.parse(list)).toEqual(list);
    expect(dashboardListResponseSchema.safeParse({ ...list, userId: 'user-1' }).success).toBe(false);

    const detail = {
      ...populatedMetric,
      evidence: populatedMetric.evidenceRefs.map((ref) => ({ ...ref, label: `Resolved ${ref.id}` })),
    };
    expect(dashboardDetailResponseSchema.parse(detail)).toEqual(detail);
    expect(dashboardDetailResponseSchema.safeParse({
      ...detail,
      evidence: [{ kind: 'unknown', id: 'opaque', label: 'Opaque' }],
    }).success).toBe(false);
  });
});