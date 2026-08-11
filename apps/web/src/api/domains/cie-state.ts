/**
 * `cie/state` domain — Career State Model reads for FM1.
 *
 * The wire response is parsed by the shared schema exported from
 * `@careeros/contracts`; this module only composes the typed client.
 *
 * FM2.2 adds the Green recompute mutation used after an authoritative profile
 * correction. All state and explanation responses remain contract-parsed.
 *
 * `userId` is server-derived from the bearer.
 */
import {
  cieStateExplainResponseSchema,
  cieStateResponseSchema,
  type CieStateExplainResponse,
  type CieStateResponse,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client.js';

/** Transport shape for one CareerStateDimension row. */
export interface CieStateApi {
  /** GET /v1/cie/state — the current Career State Model. */
  get(opts?: RequestOptions): Promise<CieStateResponse>;
  /** GET /v1/cie/state/:dimension/explain — evidence + reasoning for one dimension. */
  explain(dimension: string, opts?: RequestOptions): Promise<CieStateExplainResponse>;
  /** POST /v1/cie/state/recompute — re-derive from authoritative profile facts. */
  recompute(
    change?: { readonly factId: string; readonly reason: string },
    opts?: RequestOptions,
  ): Promise<CieStateResponse>;
}

export function createCieStateApi(client: ApiClient): CieStateApi {
  return {
    get: (opts) => client.get('/v1/cie/state', cieStateResponseSchema, opts),
    explain: (dimension, opts) =>
      client.get(
        `/v1/cie/state/${encodeURIComponent(dimension)}/explain`,
        cieStateExplainResponseSchema,
        opts,
      ),
    recompute: (change, opts) =>
      client.postGreen(
        'memory.write',
        '/v1/cie/state/recompute',
        change ?? {},
        cieStateResponseSchema,
        opts,
      ),
  };
}
