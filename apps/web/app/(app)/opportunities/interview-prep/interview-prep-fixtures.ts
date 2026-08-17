import {
  applicationListResponseSchema,
  interviewPrepResponseSchema,
  opportunityDetailSchema,
  type ApplicationListResponse,
  type InterviewPrepResponse,
  type OpportunityDetail,
} from '@careeros/contracts';

export const INTERVIEW_OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000061';

export const INTERVIEW_PIPELINE: ApplicationListResponse = applicationListResponseSchema.parse({
  data: [{
    id: 'interview-application-1', opportunityId: INTERVIEW_OPPORTUNITY_ID,
    resumeVariantId: null, status: 'interviewing', notes: null, followUpAt: null,
    appliedAt: '2026-08-14T12:00:00.000Z', createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-14T12:00:00.000Z',
  }],
});

export const INTERVIEW_OPPORTUNITY: OpportunityDetail = opportunityDetailSchema.parse({
  id: INTERVIEW_OPPORTUNITY_ID,
  source: 'greenhouse', sourceRef: 'gh-interview-1', company: 'Helios Labs',
  role: 'Staff Backend Engineer', comp: null, location: 'Remote', remote: true,
  ingestedAt: '2026-08-11T12:00:00.000Z',
  requirementsParsed: { requirements: ['TypeScript services', 'Kubernetes'] },
  rawPayload: { contentSanitized: 'Build TypeScript services and operate Kubernetes workloads.' },
});

export const GROUNDED_INTERVIEW_PREP: InterviewPrepResponse = interviewPrepResponseSchema.parse({
  status: 'ready',
  opportunityId: INTERVIEW_OPPORTUNITY_ID,
  modelVersion: 'interviewer@fake-grounded',
  questions: [{
    id: 'iq-typescript',
    kind: 'technical',
    prompt: 'Tell me about your experience with TypeScript services.',
    grounding: {
      opportunityId: INTERVIEW_OPPORTUNITY_ID,
      requirements: ['TypeScript services'],
      profileFactRefs: ['experience:typescript'],
    },
    suggestedAnswer: {
      framing: 'Use your real experience building reliable TypeScript services.',
      evidence: [{ claim: 'real work related to TypeScript services', factRef: 'experience:typescript' }],
    },
  }],
});

export const THIN_INTERVIEW_PREP: InterviewPrepResponse = interviewPrepResponseSchema.parse({
  status: 'insufficient_data',
  opportunityId: INTERVIEW_OPPORTUNITY_ID,
  reason: 'Not enough real opportunity and profile evidence to build grounded practice material.',
  modelVersion: 'interviewer@fake-grounded',
});