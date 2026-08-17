/** Typed Green interview-prep API. Grounded generation carries evidence, not confidence. */
import {
  interviewPrepRequestSchema,
  interviewPrepResponseSchema,
  type InterviewPrepRequest,
  type InterviewPrepResponse,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client';

export interface InterviewsApi {
  /** POST /v1/cie/interview/prep — advisory practice; no external action. */
  prepare(body: InterviewPrepRequest, opts?: RequestOptions): Promise<InterviewPrepResponse>;
}

export function createInterviewsApi(client: ApiClient): InterviewsApi {
  return {
    prepare: (body, opts) => client.postGreen(
      null,
      '/v1/cie/interview/prep',
      interviewPrepRequestSchema.parse(body),
      interviewPrepResponseSchema,
      opts,
    ),
  };
}