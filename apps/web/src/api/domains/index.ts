/**
 * Domain modules barrel — one composed API surface per bounded context.
 *
 * The web app builds a single `Api` object at boot from these factories, so
 * routes/components import a typed domain (e.g. `api.opportunities.list()`)
 * instead of hand-crafting fetch calls. `createApi` composes all six FM1
 * domains against a single `ApiClient`.
 */
import type { ApiClient } from '../client';
import { createMeApi, type MeApi } from './me';
import { createProfileApi, type ProfileApi } from './profile';
import { createOpportunitiesApi, type OpportunitiesApi } from './opportunities';
import { createCieStateApi, type CieStateApi } from './cie-state';
import { createBriefingsApi, type BriefingsApi } from './briefings';
import { createAuditApi, type AuditApi } from './audit';
import { createDecisionsApi, type DecisionsApi } from './decisions';
import { createApplicationsApi, type ApplicationsApi } from './applications';
import { createResumesApi, type ResumesApi } from './resumes';
import { createApprovalsApi, type ApprovalsApi } from './approvals';

export * from './me';
export * from './profile';
export * from './opportunities';
export * from './cie-state';
export * from './briefings';
export * from './audit';
export * from './decisions';
export * from './applications';
export * from './resumes';
export * from './approvals';

export interface Api {
  me: MeApi;
  profile: ProfileApi;
  opportunities: OpportunitiesApi;
  cieState: CieStateApi;
  briefings: BriefingsApi;
  audit: AuditApi;
  decisions: DecisionsApi;
  applications: ApplicationsApi;
  resumes: ResumesApi;
  approvals: ApprovalsApi;
}

export function createApi(client: ApiClient): Api {
  return {
    me: createMeApi(client),
    profile: createProfileApi(client),
    opportunities: createOpportunitiesApi(client),
    cieState: createCieStateApi(client),
    briefings: createBriefingsApi(client),
    audit: createAuditApi(client),
    decisions: createDecisionsApi(client),
    applications: createApplicationsApi(client),
    resumes: createResumesApi(client),
    approvals: createApprovalsApi(client),
  };
}
