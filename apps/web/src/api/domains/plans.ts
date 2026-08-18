/** Typed read-only Strategy Plan API. Grounded generation carries refs, not confidence. */
import {
  planSetResponseSchema,
  type PlanSetResponse,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client';

/**
 * Advisory Plan-room surface. Deliberately read-only: plan generation,
 * regeneration, action mutation, approval, and execution are not expressible
 * from this domain.
 */
export interface PlansApi {
  /** GET /v1/cie/plans — caller-scoped active plans plus today's grounded move. */
  get(opts?: RequestOptions): Promise<PlanSetResponse>;
}

export function createPlansApi(client: ApiClient): PlansApi {
  return {
    get: (opts) => client.get('/v1/cie/plans', planSetResponseSchema, opts),
  };
}