/** Typed Green drafts API. Grounded generation carries claim refs, never confidence. */
import {
  draftGenerateRequestSchema,
  draftResponseSchema,
  type DraftGenerateRequest,
  type DraftResponse,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client';

export interface DraftsApi {
  /** POST /v1/drafts — creates an advisory draft; this API exposes no send method. */
  generate(body: DraftGenerateRequest, opts?: RequestOptions): Promise<DraftResponse>;
}

export function createDraftsApi(client: ApiClient): DraftsApi {
  return {
    generate: (body, opts) => client.postGreen(
      null,
      '/v1/drafts',
      draftGenerateRequestSchema.parse(body),
      draftResponseSchema,
      opts,
    ),
  };
}