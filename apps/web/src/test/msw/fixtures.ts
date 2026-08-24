import {
  HTTP_STATUS_BY_ERROR_CODE,
  apiErrorSchema,
  auditListResponseSchema,
  briefingRunDetailSchema,
  cieStateResponseSchema,
  makeApiError,
  meResponseSchema,
  opportunityListResponseSchema,
  opportunityMatchResponseSchema,
  pendingApprovalListResponseSchema,
  portfolioResponseSchema,
  resumeModelSchema,
  resumeVariantSchema,
  type ApiError,
  type AuditListResponse,
  type BriefingRunDetail,
  type CieStateResponse,
  type ErrorCode,
  type MeResponse,
  type OpportunityListResponse,
  type OpportunityMatchResponse,
  type PendingApprovalListResponse,
  type PortfolioResponse,
  type ResumeModel,
  type ResumeVariant,
} from '@careeros/contracts';

const NOW = '2026-08-09T12:00:00.000Z';
const USER_ID = '00000000-0000-4000-8000-000000000001';

/** Parse at fixture construction time so malformed data never reaches MSW/UI. */
export const successFixtures = Object.freeze({
  me: (): MeResponse => meResponseSchema.parse({
    user: { id: USER_ID, email: 'dev@careeros.local', authProviderId: 'dev-user', subscriptionTier: 'pro', status: 'active', onboardingCompletedAt: NOW, createdAt: NOW, updatedAt: NOW },
    settings: { userId: USER_ID, autonomyDefaults: { 'briefing.item.execute': 'yellow' }, quietHours: null, briefingSchedule: null, sourcePrefs: {}, dataUseOptIns: { training: false, crossUserIntel: false }, createdAt: NOW, updatedAt: NOW },
    onboarding: { status: 'complete', completedAt: NOW },
  }),
  state: (): CieStateResponse => cieStateResponseSchema.parse({
    profileId: 'profile-1', version: 1, updatedAt: NOW,
    dimensions: [{ dimension: 'strengths', value: { values: ['Systems thinking'] }, confidence: 0.9, provenance: 'demonstrated', evidenceRefs: ['experience:1'], freshnessAt: NOW, modelVersion: 'state-v1' }],
  }),
  opportunities: (): OpportunityListResponse => opportunityListResponseSchema.parse({
    data: [{ id: 'opportunity-1', source: 'greenhouse', sourceRef: 'gh-1', company: 'Helios Labs', role: 'Staff Backend Engineer', comp: null, location: 'Remote', remote: true, ingestedAt: NOW }], nextCursor: null,
  }),
  match: (): OpportunityMatchResponse => opportunityMatchResponseSchema.parse({
    opportunityId: 'opportunity-1', overall: 87, subscores: [{ key: 'skills', value: 90 }], explanation: 'Strong grounded overlap.', evidenceRefs: ['experience:1'], modelVersion: 'match-v1',
  }),
  audit: (): AuditListResponse => auditListResponseSchema.parse({
    data: [{ id: 'audit-1', userId: USER_ID, actor: 'twin', action: 'opportunity.score', target: 'opportunity-1', reason: 'Grounded score.', modelVersion: 'match-v1', traceId: 'fixture-trace', at: NOW }], nextBefore: null,
  }),
  briefing: (): BriefingRunDetail => briefingRunDetailSchema.parse({
    id: 'briefing-1', userId: USER_ID, trigger: 'manual', status: 'complete', inputs: {}, steps: [], costTotal: 0, startedAt: NOW, finishedAt: NOW,
    items: [{ id: 'item-1', kind: 'draft', refId: 'opportunity-1', autonomyTier: 'yellow', state: 'proposed', payload: { title: 'Outreach draft' }, createdAt: NOW }],
  }),
  resumeModel: (): ResumeModel => resumeModelSchema.parse({
    id: 'base-resume-1', profileId: 'profile-1', name: 'Base résumé', base: true,
    selectedItems: [{ factId: 'experience:1', order: 0, phrasing: 'Built reliable services.' }],
  }),
  resumeVariant: (): ResumeVariant => resumeVariantSchema.parse({
    id: 'variant-1', resumeModelId: 'base-resume-1', opportunityId: '00000000-0000-4000-8000-000000000022',
    bullets: [], rendered: '', diff: { selected: [], dropped: [], rephrased: [] }, rationale: '',
    atsCheck: { passed: true, warnings: [] }, modelVersion: 'resume-tailor@fake',
  }),
  pendingApprovals: (): PendingApprovalListResponse => pendingApprovalListResponseSchema.parse({
    data: [{
      id: 'approval-1',
      action: 'briefing.item.execute',
      why: 'Send the prepared outreach only after you review its exact contents.',
      payload: { to: 'recruiter@example.com', subject: 'Staff role', body: 'Exact prepared draft.' },
      tier: 'yellow',
      resourceRefs: [{ type: 'briefingRun', id: 'briefing-1' }, { type: 'opportunity', id: 'opportunity-1' }],
      state: 'proposed',
      createdAt: NOW,
    }],
  }),
  portfolio: (): PortfolioResponse => portfolioResponseSchema.parse({
    content: {
      status: 'ready',
      headline: { text: 'Grounded portfolio headline', factRefs: ['experience:1'] },
      summary: { text: 'Built only from recorded work.', factRefs: ['experience:1'] },
      projects: [{ title: 'Recorded project', description: 'A real project.', skills: ['TypeScript'], factRefs: ['project:1'] }],
      skills: [{ skill: 'TypeScript', factRefs: ['skill:1'] }],
      modelVersion: 'portfolio@fake-grounded',
    },
    publishStatus: 'private',
    slug: 'fixture-portfolio',
    publishedAt: null,
    hasPublishedSnapshot: false,
  }),
});

export const stateFixtures = Object.freeze({
  insufficientData: (): CieStateResponse => cieStateResponseSchema.parse({
    profileId: 'profile-1', version: 1, updatedAt: NOW,
    dimensions: [{ dimension: 'leadership_readiness', value: { values: [] }, confidence: 0, provenance: 'no-signal', evidenceRefs: [], freshnessAt: NOW, modelVersion: 'state-v1' }],
  }),
  partialResult: (): BriefingRunDetail => briefingRunDetailSchema.parse({
    id: 'briefing-partial', userId: USER_ID, trigger: 'scheduled', status: 'partial', inputs: {}, costTotal: 0.01, startedAt: NOW, finishedAt: NOW,
    steps: [{ name: 'score', status: 'ok', costUsd: 0.01, traceId: 'trace-score', startedAt: NOW, finishedAt: NOW, itemsProduced: 1 }, { name: 'draft', status: 'failed', costUsd: 0, traceId: 'trace-draft', startedAt: NOW, finishedAt: NOW, itemsProduced: 0, error: 'temporary failure', retryable: true }],
    items: [{ id: 'item-composed', kind: 'opportunity', refId: 'opportunity-1', autonomyTier: 'green', state: 'proposed', payload: { title: 'Composed before failure' }, createdAt: NOW }],
  }),
});

export function errorFixture(
  code: ErrorCode,
  details?: Record<string, unknown>,
): { readonly status: number; readonly body: ApiError } {
  return {
    status: HTTP_STATUS_BY_ERROR_CODE[code],
    body: apiErrorSchema.parse(makeApiError(code, `Fixture: ${code}`, { details, traceId: 'fixture-trace' })),
  };
}

export const errorFixtures = Object.freeze({
  capabilityDenied: () => errorFixture('capability_denied', { action: 'draft.send' }),
  validation: () => errorFixture('validation_failed', { email: 'Must be an email.' }),
  rateLimit: () => errorFixture('rate_limited', { retryAfterSeconds: 30 }),
});

/** Regression-only seam: proves schema failures happen before an MSW handler exists. */
export function parseFixtureForTest(raw: unknown): OpportunityListResponse {
  return opportunityListResponseSchema.parse(raw);
}
