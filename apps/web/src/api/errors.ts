/**
 * Typed ApiError for the CareerOS web client.
 *
 * Wraps the shared error model from `@careeros/contracts` (see
 * `packages/contracts/src/error.ts`) into a client-side Error subclass that
 * carries the ErrorCode, human message, structured details, and traceId so
 * every recovery path in `docs/frontend-architecture.md §9` has the data it
 * needs. **No error is ever swallowed** — parse failures surface as a typed
 * `internal` ApiError with the offending payload attached to `details`, and
 * network faults surface as a typed `internal` too (never `null`).
 *
 * The recovery map (docs/frontend-architecture.md §9 + docs/api-spec.md §2)
 * is exported here so the shell error boundary + Trust Kit render it without
 * re-declaring the mapping.
 */
import { apiErrorSchema, type ApiError as ContractApiError, type ErrorCode } from '@careeros/contracts';

/** Client-side ApiError — flattened `{ code, message, details, traceId }` so consumers don't dig through `.error.*`. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;
  readonly traceId: string | undefined;
  /** HTTP status the transport saw, when known. Undefined for pre-response failures (network/parse). */
  readonly status: number | undefined;

  constructor(init: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    traceId?: string;
    status?: number;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.details = init.details ? Object.freeze({ ...init.details }) : undefined;
    this.traceId = init.traceId;
    this.status = init.status;
  }
}

/**
 * Attempt to parse an error payload from the server. If the body is not a
 * conforming ApiError, we return a typed `internal` with the raw payload
 * attached to `details.rawBody` — the caller still gets an `ApiError`, never
 * `null`, so the boundary error renderer can always run.
 */
export function parseApiErrorPayload(
  rawBody: unknown,
  fallback: { status: number; traceId?: string },
): ApiError {
  const parsed = apiErrorSchema.safeParse(rawBody);
  if (parsed.success) {
    const contract: ContractApiError = parsed.data;
    return new ApiError({
      code: contract.error.code,
      message: contract.error.message,
      ...(contract.error.details !== undefined ? { details: contract.error.details } : {}),
      traceId: contract.error.traceId ?? fallback.traceId,
      status: fallback.status,
    });
  }
  return new ApiError({
    code: 'internal',
    message: `Malformed error payload (HTTP ${fallback.status}).`,
    details: { rawBody, zodIssues: parsed.error.issues },
    ...(fallback.traceId !== undefined ? { traceId: fallback.traceId } : {}),
    status: fallback.status,
  });
}

/**
 * Recovery affordance for a given ApiError code. Guarantee suite #6:
 * a `capability_denied` (or any other coded failure) NEVER results in a
 * silent no-op — the error-recovery renderer maps every code to a designed
 * path per docs/frontend-architecture.md §9.
 *
 * We express recovery as a discriminated union so callers can pattern-match;
 * exhaustiveness is enforced by TypeScript at every call site.
 */
export type ErrorRecovery =
  | { kind: 'reauthenticate'; retriable: true }
  | { kind: 'show_forbidden' }
  | { kind: 'show_not_found' }
  | { kind: 'show_field_errors'; fields: Readonly<Record<string, unknown>> | undefined }
  | { kind: 'backoff_and_retry'; retryAfterSeconds: number | undefined }
  | { kind: 'request_approval'; action: string | undefined }
  | { kind: 'explain_source_policy'; source: string | undefined }
  | { kind: 'resolve_conflict'; details: Readonly<Record<string, unknown>> | undefined }
  | { kind: 'show_trace_and_retry'; traceId: string | undefined };

/** Map every ErrorCode to its designed recovery affordance. Exhaustive. */
export function recoveryForError(err: ApiError): ErrorRecovery {
  switch (err.code) {
    case 'unauthenticated':
      return { kind: 'reauthenticate', retriable: true };
    case 'forbidden':
      return { kind: 'show_forbidden' };
    case 'not_found':
      return { kind: 'show_not_found' };
    case 'validation_failed':
      return { kind: 'show_field_errors', fields: err.details };
    case 'rate_limited': {
      const raw = err.details?.['retryAfterSeconds'];
      const retryAfterSeconds = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
      return { kind: 'backoff_and_retry', retryAfterSeconds };
    }
    case 'capability_denied': {
      const raw = err.details?.['action'];
      const action = typeof raw === 'string' ? raw : undefined;
      return { kind: 'request_approval', action };
    }
    case 'source_not_allowed': {
      const raw = err.details?.['source'];
      const source = typeof raw === 'string' ? raw : undefined;
      return { kind: 'explain_source_policy', source };
    }
    case 'conflict':
      return { kind: 'resolve_conflict', details: err.details };
    case 'internal':
      return { kind: 'show_trace_and_retry', traceId: err.traceId };
    default: {
      // Exhaustiveness guard — a new ErrorCode landing in @careeros/contracts
      // will fail the build here until this map is extended.
      const _exhaustive: never = err.code;
      return _exhaustive;
    }
  }
}