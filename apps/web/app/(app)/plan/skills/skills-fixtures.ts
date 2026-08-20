import {
  applicationListResponseSchema,
  opportunityDetailSchema,
  skillGapsResponseSchema,
  type ApplicationListResponse,
  type OpportunityDetail,
  type SkillGapsResponse,
} from '@careeros/contracts';

export const SKILLS_OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000081';

export const SKILLS_PIPELINE: ApplicationListResponse = applicationListResponseSchema.parse({
  data: [
    {
      id: 'skills-application-1',
      opportunityId: SKILLS_OPPORTUNITY_ID,
      resumeVariantId: null,
      status: 'interviewing',
      notes: null,
      followUpAt: null,
      appliedAt: '2026-08-17T12:00:00.000Z',
      createdAt: '2026-08-10T12:00:00.000Z',
      updatedAt: '2026-08-20T12:00:00.000Z',
    },
  ],
});

export const SKILLS_OPPORTUNITY: OpportunityDetail = opportunityDetailSchema.parse({
  id: SKILLS_OPPORTUNITY_ID,
  source: 'greenhouse',
  sourceRef: 'skills-gh-1',
  company: 'Nimbus',
  role: 'Platform Engineer',
  comp: null,
  location: 'Remote',
  remote: true,
  ingestedAt: '2026-08-20T12:00:00.000Z',
  requirementsParsed: { skills: ['Kubernetes'] },
  rawPayload: { contentSanitized: 'Operate Kubernetes workloads.' },
});

export const POPULATED_SKILL_GAPS: SkillGapsResponse = skillGapsResponseSchema.parse({
  status: 'ok',
  gaps: [
    {
      id: '00000000-0000-4000-8000-000000000091',
      skill: 'kubernetes',
      gap: 'Kubernetes is required by Nimbus — Platform Engineer but is not among your demonstrated skills.',
      severity: 'high',
      source: 'per_opp',
      opportunityId: SKILLS_OPPORTUNITY_ID,
      evidenceRefs: [
        { kind: 'opportunity_requirement', opportunityId: SKILLS_OPPORTUNITY_ID, requirement: 'kubernetes' },
        { kind: 'match_subscore', opportunityId: SKILLS_OPPORTUNITY_ID, key: 'skills', value: 31 },
      ],
      modelVersion: 'gap-analyzer@1.0.0',
      computedAt: '2026-08-20T12:00:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-000000000092',
      skill: 'leadership_readiness',
      gap: 'Your leadership-readiness signal is weak relative to your stated target role.',
      severity: 'medium',
      source: 'aggregate',
      opportunityId: null,
      evidenceRefs: [
        { kind: 'state_dimension', dimension: 'leadership_readiness', signal: 'weak' },
        { kind: 'target_role', role: 'Engineering Manager' },
      ],
      modelVersion: 'gap-analyzer@1.0.0',
      computedAt: '2026-08-20T12:00:00.000Z',
    },
  ],
});

export const SCOPED_SKILL_GAPS: SkillGapsResponse = skillGapsResponseSchema.parse({
  status: 'ok',
  gaps: POPULATED_SKILL_GAPS.status === 'ok' ? [POPULATED_SKILL_GAPS.gaps[0]] : [],
});

export const EMPTY_SKILL_GAPS: SkillGapsResponse = skillGapsResponseSchema.parse({
  status: 'ok',
  gaps: [],
});

export const INSUFFICIENT_SKILL_GAPS: SkillGapsResponse = skillGapsResponseSchema.parse({
  status: 'insufficient_data',
});