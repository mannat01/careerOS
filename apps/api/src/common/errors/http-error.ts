import {
  HTTP_STATUS_BY_ERROR_CODE,
  makeApiError,
  type ApiError,
  type ErrorCode,
} from '@careeros/contracts';

/** Uniform handler result. NestJS controllers will map this 1:1 once wired. */
export interface HandlerResponse<T> {
  status: number;
  body: T | ApiError;
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  options?: { details?: Record<string, unknown>; traceId?: string },
): HandlerResponse<never> {
  return { status: HTTP_STATUS_BY_ERROR_CODE[code], body: makeApiError(code, message, options) };
}

export function ok<T>(body: T): HandlerResponse<T> {
  return { status: 200, body };
}
