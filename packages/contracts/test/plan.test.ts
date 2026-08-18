import { describe, expect, it } from 'vitest';
import { planResponseSchema, planSetResponseSchema } from '../src/index.js';

const NOW = '2026-08-17T12:00:00.000Z';

const PLAN = {
  id: 'plan-30d',
  horizon: '30d' as const,
  summary: 'Build evidence toward the stated platform-engineering goal.',
  goalRefs: ['goal:career_goals:0'],
  diffSummary: null,
  rationale: 'Initial plan generation.',
  modelVersion: 'strategic-planner@1.0.0',
  createdAt: NOW,
  updatedAt: NOW,
  actions: [{
    id: 'action-1',
    kind: 'project' as const,
    title: 'Complete the caller-owned reliability project.',
    rationale: 'The project and goal references are present in caller state.',
    status: 'suggested' as const,
    progress: 0,
    evidenceRefs: ['goal:career_goals:0', 'node:project:reliability'],
  }],
};

describe('FM6.2-pre public planner contracts', () => {
  it('strictly parses a grounded active plan set without numeric confidence', () => {
    const response = {
      status: 'ready' as const,
      plans: [PLAN],
      todaysMove: { actionId: 'action-1', horizon: '30d' as const, title: PLAN.actions[0]!.title },
    };

    expect(planSetResponseSchema.parse(response)).toEqual(response);
    expect(planResponseSchema.safeParse({ ...PLAN, confidence: 0.8 }).success).toBe(false);
    expect(planResponseSchema.safeParse({
      ...PLAN,
      actions: [{ ...PLAN.actions[0], confidence: 0.8 }],
    }).success).toBe(false);
  });

  it('rejects persistence-only fields and malformed grounding metadata', () => {
    expect(planResponseSchema.safeParse({ ...PLAN, status: 'active' }).success).toBe(false);
    expect(planResponseSchema.safeParse({ ...PLAN, supersededById: null }).success).toBe(false);
    expect(planResponseSchema.safeParse({
      ...PLAN,
      actions: [{ ...PLAN.actions[0], actionKey: 'internal-key', orderIndex: 0 }],
    }).success).toBe(false);
    expect(planResponseSchema.safeParse({ ...PLAN, createdAt: 'not-a-date' }).success).toBe(false);
  });

  it('strictly parses the honest no-plan shape', () => {
    const response = {
      status: 'insufficient_data' as const,
      plans: [] as [],
      todaysMove: null,
      reason: 'No active plan is available yet.',
    };

    expect(planSetResponseSchema.parse(response)).toEqual(response);
    expect(planSetResponseSchema.safeParse({ ...response, confidence: 0 }).success).toBe(false);
    expect(planSetResponseSchema.safeParse({ ...response, plans: [PLAN] }).success).toBe(false);
  });
});