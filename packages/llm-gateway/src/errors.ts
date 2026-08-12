export type LlmGatewayErrorCode =
  | 'http_error'
  | 'invalid_response'
  | 'timeout'
  | 'transport_error';

/**
 * A safe, provider-boundary failure. Messages and metadata deliberately exclude
 * credentials and request/response bodies so callers can report the error
 * without leaking prompt content or secrets.
 */
export class LlmGatewayError extends Error {
  readonly name = 'LlmGatewayError';

  constructor(
    message: string,
    readonly code: LlmGatewayErrorCode,
    readonly metadata: Readonly<{ status?: number; requestId?: string }> = {},
  ) {
    super(message);
  }
}