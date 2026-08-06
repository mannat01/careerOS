/**
 * `cie/state` domain — Career State Model reads for FM1.
 *
 * The persisted CIE state model shape lives in the server package
 * `@careeros/cie-state`, and its zod schema is not (yet) surfaced through
 * `@careeros/contracts` — so this module defines a MINIMAL wire schema that
 * validates only the shape the web app reads. It is intentionally the
 * transport contract, NOT a redeclaration of the domain (values are `unknown`,
 * evidence refs are `string[]`); if the server tightens, only this file needs
 * to update.
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