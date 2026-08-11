import {
  opportunityDetailSchema,
  opportunityListResponseSchema,
  opportunityMatchResponseSchema,
  type OpportunityDetail,
  type OpportunityListResponse,
  type OpportunityMatchResponse,
} from '@careeros/contracts';

const NOW = '2026-08-11T12:00:00.000Z';

export const POPULATED_OPPORTUNITIES: OpportunityListResponse = opportunityListResponseSchema.parse({
  data: [
    {
      id: 'opportunity-1',
      source: 'greenhouse',
      sourceRef: 'gh-1',
      company: 'Helios Labs',
      role: 'Staff Backend Engineer',
      comp: { currency: 'USD', base: { min: 210000, max: 250000 } },
      location: 'Remote (US)',
      remote: true,
      ingestedAt: NOW,
    },
    {
      id: 'opportunity-2',
      source: 'lever',
      sourceRef: 'lever-2',
      company: 'Cobalt Health',
      role: 'Senior Platform Engineer',
      comp: null,
      location: 'Austin, TX',
      remote: false,
      ingestedAt: '2026-08-10T12:00:00.000Z',
    },
  ],
  nextCursor: 'cursor-page-2',
});

export const EMPTY_OPPORTUNITIES: OpportunityListResponse = opportunityListResponseSchema.parse({
  data: [],
  nextCursor: null,
});

export const POPULATED_OPPORTUNITY_DETAIL: OpportunityDetail = opportunityDetailSchema.parse({
  ...POPULATED_OPPORTUNITIES.data[0]!,
  requirementsParsed: {
    mustHave: ['TypeScript', 'PostgreSQL', 'Kubernetes'],
    niceToHave: ['Distributed systems'],
  },
  rawPayload: {
    contentSanitized: 'Build reliable APIs and operate Kubernetes services.',
    injectionFlags: [],
  },
});

export const POPULATED_MATCH: OpportunityMatchResponse = opportunityMatchResponseSchema.parse({
  opportunityId: 'opportunity-1',
  overall: 78,
  subscores: [
    { key: 'skills_match', value: 67 },
    { key: 'experience_relevance', value: 91 },
    { key: 'location_fit', value: 95 },
  ],
  explanation:
    'Strong evidence for TypeScript and PostgreSQL. Gap: Kubernetes is demanded by this role but is not demonstrated in the profile evidence.',
  evidenceRefs: ['experience:experience-1', 'skill:skill-1'],
  modelVersion: 'match-scorer@1.0.0',
});

export const SECOND_MATCH: OpportunityMatchResponse = opportunityMatchResponseSchema.parse({
  opportunityId: 'opportunity-2',
  overall: 62,
  subscores: [
    { key: 'skills_match', value: 72 },
    { key: 'location_fit', value: 40 },
  ],
  explanation: 'Platform evidence overlaps, but the returned location fit is lower.',
  evidenceRefs: ['experience:experience-1'],
  modelVersion: 'match-scorer@1.0.0',
});

export const MATCH_BY_OPPORTUNITY: Readonly<Record<string, OpportunityMatchResponse>> = {
  'opportunity-1': POPULATED_MATCH,
  'opportunity-2': SECOND_MATCH,
};