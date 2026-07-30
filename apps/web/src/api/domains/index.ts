/**
 * Domain modules barrel — one composed API surface per bounded context.
 *
 * The web app builds a single `Api` object at boot from these factories, so
 * routes/components import a typed domain (e.g. `api.opportunities.list()`)
 * instead of hand-crafting fetch calls. `createApi` composes all six FM1
 * domains against a single `ApiClient`.
 */
import type { ApiClient } from '../client.js';
import { createMeApi, type MeApi } from './me.js';
import { createProfileApi, type ProfileApi } from './profile.js';
import { createOpportunitiesApi, type OpportunitiesApi } from './opportunities.js';
import { createCieStateApi, type CieStateApi } from './cie-state.js';
import { createBriefingsApi, type BriefingsApi } from './briefings.js';
import { createAuditApi, type AuditApi } from './audit.js';

export * from './me.js';
export * from './profile.js';
export * from './opportunities.js';
export * from './cie-state.js';
export * from './briefings.js';
export * from './audit.js';

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