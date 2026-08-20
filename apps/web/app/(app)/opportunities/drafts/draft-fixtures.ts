import {
  applicationListResponseSchema,
  draftResponseSchema,
  opportunityDetailSchema,
  type ApplicationListResponse,
  type DraftResponse,
  type OpportunityDetail,
} from '@careeros/contracts';

export const DRAFT_OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000063';

export const DRAFT_PIPELINE: ApplicationListResponse = applicationListResponseSchema.parse({
  data: [{
    id: 'draft-application-1', opportunityId: DRAFT_OPPORTUNITY_ID,
    resumeVariantId: null, status: 'drafting', notes: null, followUpAt: null,
    appliedAt: null, createdAt: '2026-08-15T12:00:00.000Z', updatedAt: '2026-08-15T12:00:00.000Z',
  }],
});

export const DRAFT_OPPORTUNITY: OpportunityDetail = opportunityDetailSchema.parse({
  id: DRAFT_OPPORTUNITY_ID,
  source: 'greenhouse', sourceRef: 'gh-draft-1', company: 'Nimbus',
  role: 'Staff Engineer', comp: null, location: 'Remote', remote: true,
  ingestedAt: '2026-08-15T12:00:00.000Z',
  requirementsParsed: { requirements: ['TypeScript services'] },
  rawPayload: { contentSanitized: 'Build reliable TypeScript services.' },
});

export const GROUNDED_DRAFT: DraftResponse = draftResponseSchema.parse({
  id: '00000000-0000-4000-8000-000000000064',
  kind: 'cover_letter',
  opportunityId: DRAFT_OPPORTUNITY_ID,
  recipient: null,
  subject: 'Application for Staff Engineer at Nimbus',
  body: 'Hello,\n\nFor "TypeScript services": Built reliable TypeScript services.\n\nThank you for your consideration.',
  claims: [{
    claim: 'For "TypeScript services": Built reliable TypeScript services.',
    factRef: 'experience:typescript',
  }],
  modelVersion: 'drafter@fake-grounded',
  status: 'draft',
  sentAt: null,
  createdAt: '2026-08-18T12:00:00.000Z',
});

export const THIN_DRAFT: DraftResponse = draftResponseSchema.parse({ status: 'insufficient_data' });