/** Contract-verified PKM CRUD. Every operation is Green and caller-scoped server-side. */
import {
  pkmCreateRequestSchema,
  pkmDeleteResponseSchema,
  pkmEntrySchema,
  pkmListResponseSchema,
  pkmUpdateRequestSchema,
  type PkmCreateRequest,
  type PkmDeleteResponse,
  type PkmEntry,
  type PkmListResponse,
  type PkmUpdateRequest,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client';

export interface PkmApi {
  list(opts?: RequestOptions): Promise<PkmListResponse>;
  create(body: PkmCreateRequest, opts?: RequestOptions): Promise<PkmEntry>;
  update(id: string, body: PkmUpdateRequest, opts?: RequestOptions): Promise<PkmEntry>;
  delete(id: string, opts?: RequestOptions): Promise<PkmDeleteResponse>;
}

export function createPkmApi(client: ApiClient): PkmApi {
  return {
    list: (opts) => client.get('/v1/pkm', pkmListResponseSchema, opts),
    create: (body, opts) => client.postGreen(
      null,
      '/v1/pkm',
      pkmCreateRequestSchema.parse(body),
      pkmEntrySchema,
      opts,
    ),
    update: (id, body, opts) => client.patch(
      `/v1/pkm/${encodeURIComponent(id)}`,
      pkmUpdateRequestSchema.parse(body),
      pkmEntrySchema,
      opts,
    ),
    delete: (id, opts) => client.del(
      `/v1/pkm/${encodeURIComponent(id)}`,
      pkmDeleteResponseSchema,
      opts,
    ),
  };
}