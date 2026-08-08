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

export * from './me';
export * from './profile';
export * from './opportunities';
export * from './cie-state';
export * from './briefings';
export * from './audit';

export interface Api {
  me: MeApi;
  profile: ProfileApi;
  opportunities: OpportunitiesApi;
  cieState: CieStateApi;
  briefings: BriefingsApi;
  audit: AuditApi;
}

export function createApi(client: ApiClient): Api {
  return {
    me: createMeApi(client),
    profile: createProfileApi(client),
    opportunities: createOpportunitiesApi(client),
    cieState: createCieStateApi(client),
    briefings: createBriefingsApi(client),
    audit: createAuditApi(client),
  };
}