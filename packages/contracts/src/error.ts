import { z } from 'zod';

/** Shared API error model — api-spec.md §2. Single source of truth for both sides. */

export const errorCodeSchema = z.enum([
  'unauthenticated',
  'forbidden',
  'not_found',
  'validation_failed',
  'rate_limited',
  'capability_denied', // autonomy-gate (first-class so clients render the consent path)
  'source_not_allowed', // connector allow-list (first-class, same reason)
  'conflict',
  'internal',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const HTTP_STATUS_BY_ERROR_CODE: Readonly<Record<ErrorCode, number>> = Object.freeze({
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  rate_limited: 429,
  capability_denied: 403,
  source_not_allowed: 403,
  conflict: 409,
  internal: 500,
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    traceId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export function makeApiError(
  code: ErrorCode,
  message: string,
  options?: { details?: Record<string, unknown>; traceId?: string },
): ApiError {
  return {
    error: {
      code,
      message,
      ...(options?.details !== undefined ? { details: options.details } : {}),
      ...(options?.traceId !== undefined ? { traceId: options.traceId } : {}),
    },
  };
}
