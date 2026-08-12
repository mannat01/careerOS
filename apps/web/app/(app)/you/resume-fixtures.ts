import {
  applicationListResponseSchema,
  opportunityDetailSchema,
  resumeModelSchema,
  resumeVariantSchema,
  type ApplicationListResponse,
  type OpportunityDetail,
  type ResumeModel,
  type ResumeVariant,
} from '@careeros/contracts';

export const RESUME_OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000022';

export const BASE_RESUME: ResumeModel = resumeModelSchema.parse({
  id: 'base-resume-1',
  profileId: 'profile-1',
  name: 'Base résumé',
  selectedItems: [
    { factId: 'experience:1', order: 0, phrasing: 'Built reliable TypeScript services.' },
    { factId: 'skill:1', order: 1 },
  ],
  base: true,
});

export const RESUME_PIPELINE: ApplicationListResponse = applicationListResponseSchema.parse({
  data: [{
    id: 'application-1', opportunityId: RESUME_OPPORTUNITY_ID, resumeVariantId: null,
    status: 'saved', notes: null, followUpAt: null, appliedAt: null,
    createdAt: '2026-08-10T12:00:00.000Z', updatedAt: '2026-08-11T12:00:00.000Z',
  }],
});

export const RESUME_OPPORTUNITY: OpportunityDetail = opportunityDetailSchema.parse({
  id: RESUME_OPPORTUNITY_ID,
  source: 'greenhouse', sourceRef: 'gh-1', company: 'Helios Labs', role: 'Staff Backend Engineer',
  comp: null, location: 'Remote', remote: true, ingestedAt: '2026-08-11T12:00:00.000Z',
  requirementsParsed: { mustHave: ['TypeScript'] },
  rawPayload: { contentSanitized: 'Build reliable services.' },
});

export const GROUNDED_VARIANT: ResumeVariant = resumeVariantSchema.parse({
  id: 'variant-1', resumeModelId: BASE_RESUME.id, opportunityId: RESUME_OPPORTUNITY_ID,
  bullets: [{ factId: 'experience:1', text: 'Built reliable TypeScript services for production systems.' }],
  rendered: 'Built reliable TypeScript services for production systems.',
  diff: {
    selected: ['experience:1'],
    dropped: ['skill:1'],
    rephrased: [{ factId: 'experience:1', from: 'Built reliable TypeScript services.', to: 'Built reliable TypeScript services for production systems.' }],
  },
  rationale: 'Selected the real experience fact that overlaps with the sanctioned opportunity.',
  atsCheck: { passed: false, warnings: ['Use standard section headings for safer parsing.'] },
  modelVersion: 'resume-tailor@fake',
});

export const THIN_VARIANT: ResumeVariant = resumeVariantSchema.parse({
  id: 'variant-thin', resumeModelId: BASE_RESUME.id, opportunityId: RESUME_OPPORTUNITY_ID,
  bullets: [], rendered: '',
  diff: { selected: [], dropped: [], rephrased: [] },
  rationale: '',
  atsCheck: { passed: true, warnings: [] },
  modelVersion: 'resume-tailor@fake',
});