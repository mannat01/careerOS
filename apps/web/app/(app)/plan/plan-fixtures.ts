import { planSetResponseSchema } from '@careeros/contracts';

const CREATED_AT = '2026-08-16T09:00:00.000Z';
const UPDATED_AT = '2026-08-17T14:30:00.000Z';

export const POPULATED_PLAN = planSetResponseSchema.parse({
  status: 'ready',
  plans: [
    {
      id: 'plan-30d',
      horizon: '30d',
      summary: 'Build evidence toward your stated platform-engineering goal.',
      goalRefs: ['goal:career_goals:0'],
      diffSummary: null,
      rationale: 'Initial plan generation.',
      modelVersion: 'strategic-planner@fake-grounded',
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      actions: [{
        id: 'action-project',
        kind: 'project',
        title: 'Complete the reliability project already in your profile.',
        rationale: 'This advances your stated goal through a real project node.',
        status: 'in_progress',
        progress: 40,
        evidenceRefs: ['goal:career_goals:0', 'node:project:reliability'],
      }],
    },
    {
      id: 'plan-90d',
      horizon: '90d',
      summary: 'Use real pipeline feedback to refine the next milestone.',
      goalRefs: ['goal:career_goals:0'],
      diffSummary: 'Moved pipeline review earlier after a material state change.',
      rationale: 'The active pipeline is now the strongest grounding source.',
      modelVersion: 'strategic-planner@fake-grounded',
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      actions: [{
        id: 'action-pipeline',
        kind: 'role',
        title: 'Review the opportunities already saved in your pipeline.',
        rationale: 'These roles are real caller-owned state, not invented targets.',
        status: 'suggested',
        progress: 0,
        evidenceRefs: ['goal:career_goals:0', 'node:role:platform'],
      }],
    },
  ],
  todaysMove: {
    actionId: 'action-project',
    horizon: '30d',
    title: 'Complete the reliability project already in your profile.',
  },
});

export const THIN_PLAN = planSetResponseSchema.parse({
  status: 'insufficient_data',
  plans: [],
  todaysMove: null,
  reason: 'No active plan is available yet.',
});

export const PARTIALLY_GROUNDED_PLAN = planSetResponseSchema.parse({
  status: 'ready',
  plans: [{
    id: 'plan-thin-action',
    horizon: '30d',
    summary: 'A plan exists, but its returned grounding is incomplete.',
    goalRefs: ['goal:career_goals:0'],
    diffSummary: null,
    rationale: null,
    modelVersion: 'strategic-planner@fake-grounded',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    actions: [{
      id: 'action-without-evidence',
      kind: 'other',
      title: 'This generated title must not render.',
      rationale: 'This rationale must not render without grounding.',
      status: 'suggested',
      progress: 0,
      evidenceRefs: [],
    }],
  }],
  todaysMove: {
    actionId: 'action-without-evidence',
    horizon: '30d',
    title: 'This generated title must not render.',
  },
});