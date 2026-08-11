import {
  applicationDetailSchema,
  applicationListResponseSchema,
  applicationSchema,
  type Application,
  type ApplicationDetail,
  type ApplicationListResponse,
} from '@careeros/contracts';

const OPP_1 = '00000000-0000-4000-8000-000000000022';
const OPP_2 = '00000000-0000-4000-8000-000000000023';
const OPP_3 = '00000000-0000-4000-8000-000000000024';
const T0 = '2026-08-10T12:00:00.000Z';
const T1 = '2026-08-11T12:00:00.000Z';

export function makeApplication(overrides: Partial<Application> & Pick<Application, 'id' | 'opportunityId'>): Application {
  return applicationSchema.parse({
    id: overrides.id,
    opportunityId: overrides.opportunityId,
    resumeVariantId: overrides.resumeVariantId ?? null,
    status: overrides.status ?? 'saved',
    notes: overrides.notes ?? null,
    followUpAt: overrides.followUpAt ?? null,
    appliedAt: overrides.appliedAt ?? null,
    createdAt: overrides.createdAt ?? T0,
    updatedAt: overrides.updatedAt ?? T1,
  });
}

export const POPULATED_PIPELINE: ApplicationListResponse = applicationListResponseSchema.parse({
  data: [
    makeApplication({ id: 'app-1', opportunityId: OPP_1, status: 'saved' }),
    makeApplication({ id: 'app-2', opportunityId: OPP_2, status: 'ready' }),
    makeApplication({ id: 'app-3', opportunityId: OPP_3, status: 'interviewing' }),
  ],
});

export const EMPTY_PIPELINE: ApplicationListResponse = applicationListResponseSchema.parse({ data: [] });

export const SAVED_APPLICATION_DETAIL: ApplicationDetail = applicationDetailSchema.parse({
  ...makeApplication({ id: 'app-saved', opportunityId: OPP_1, status: 'saved' }),
  timeline: [{
    id: 'timeline-saved',
    fromStatus: null,
    toStatus: 'saved',
    actor: 'user',
    note: null,
    at: T1,
  }],
});
