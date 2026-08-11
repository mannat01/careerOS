/**
 * `applications` domain — the pipeline CRM read/write client (M04, FM3.3).
 *
 * All wire shapes come from `@careeros/contracts` — this module NEVER declares
 * request/response types itself. The web client is authoritative-boundary-only:
 * every response is Zod-validated at the ApiClient boundary and every wire body
 * is parsed through the contract schema before it leaves this module.
 *
 * CORE invariant surfaced at the type layer: `patch(...)` accepts the full
 * `ApplicationPatchRequest` shape (which permits `iSubmitted: true`) so the
 * status-machine gate that enforces "applied is set only by an explicit user
 * submit" can succeed. Callers wanting to move a card into `applied` MUST
 * carry that flag through — the board UI enforces this via a distinct
 * confirmation step, not an ordinary drag/move.
 */
import {
  applicationDetailSchema,
  applicationListResponseSchema,
  applicationCreateRequestSchema,
  applicationPatchRequestSchema,
  type ApplicationCreateRequest,
  type ApplicationDetail,
  type ApplicationListResponse,
  type ApplicationPatchRequest,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client';

export interface ApplicationsApi {
  /** GET /v1/applications — the caller's pipeline. */
  list(opts?: RequestOptions): Promise<ApplicationListResponse>;
  /** POST /v1/applications — create a `saved` record from an opportunity id. */
  create(body: ApplicationCreateRequest, opts?: RequestOptions): Promise<ApplicationDetail>;
  /** PATCH /v1/applications/:id — status/notes; carries `iSubmitted` when applying. */
  patch(id: string, body: ApplicationPatchRequest, opts?: RequestOptions): Promise<ApplicationDetail>;
}

export function createApplicationsApi(client: ApiClient): ApplicationsApi {
  return {
    list: (opts) => client.get('/v1/applications', applicationListResponseSchema, opts),
    create: (body, opts) => {
      // Parse the request body so a caller cannot accidentally send an
      // opportunity id that doesn't match the contract (e.g. non-uuid).
      const parsed = applicationCreateRequestSchema.parse(body);
      return client.postGreen(
        null,
        '/v1/applications',
        parsed,
        applicationDetailSchema,
        opts,
      );
    },
    patch: (id, body, opts) => {
      const parsed = applicationPatchRequestSchema.parse(body);
      return client.patch(
        `/v1/applications/${encodeURIComponent(id)}`,
        parsed,
        applicationDetailSchema,
        opts,
      );
    },
  };
}
