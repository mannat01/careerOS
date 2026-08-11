/** Typed advisory decision-support API. It can reason, but cannot apply. */
import {
  decisionSupportRequestSchema,
  decisionSupportResponseSchema,
  type DecisionSupportResponse,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client';

export interface DecisionsApi {
  /** POST /v1/cie/decide — Green advice with no external side effect. */
  decide(opportunityId: string, opts?: RequestOptions): Promise<DecisionSupportResponse>;
}

export function createDecisionsApi(client: ApiClient): DecisionsApi {
  return {
    decide: (opportunityId, opts) => {
      const body = decisionSupportRequestSchema.parse({
        question: 'Should I apply?',
        context: opportunityId,
      });
      return client.postGreen(
        null,
        '/v1/cie/decide',
        body,
        decisionSupportResponseSchema,
        opts,
      );
    },
  };
}