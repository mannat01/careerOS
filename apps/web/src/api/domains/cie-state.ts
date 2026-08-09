/**
 * `cie/state` domain — Career State Model reads for FM1.
 *
 * The wire response is parsed by the shared schema exported from
 * `@careeros/contracts`; this module only composes the typed client.
 *
 * Read-only. `POST /v1/cie/state/recompute` is a Green mutation and lives on
 * the API but is deferred out of FM1's client (no UI need it today).
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
  };
}