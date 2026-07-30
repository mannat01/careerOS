/**
 * `profile` domain — the user's canonical profile (identity, work history,
 * education, projects, achievements) that seeds every downstream agent.
 *
 * FM1 needs the read path plus the M02 profile-import flow so the sign-in →
 * import → dashboard onboarding sequence works end-to-end. All wire shapes
 * are imported from `@careeros/contracts` (`profileImportRequestSchema`,
 * `profileImportResponseSchema`).
 *
 * `userId` never crosses this boundary — the server resolves it from the
 * verified bearer token; supplying one client-side would be a privilege-
 * escalation vector.
 */
import {
  profileImportRequestSchema,
  profileImportResponseSchema,
  type ProfileImportRequest,
  type ProfileImportResponse,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client.js';

export interface ProfileApi {
  /**
   * POST /v1/profile/import — parse a resume/LinkedIn URL/JSON blob into
   * `ImportedEntity[]`. Green (advisory; user still confirms via the review
   * step in the onboarding flow).
   */
  import(body: ProfileImportRequest, opts?: RequestOptions): Promise<ProfileImportResponse>;
}

export function createProfileApi(client: ApiClient): ProfileApi {
  return {
    import: (body, opts) => {
      const parsed = profileImportRequestSchema.parse(body);
      return client.postGreen(
        'memory.write',
        '/v1/profile/import',
        parsed,
        profileImportResponseSchema,
        opts,
      );
    },
  };
}