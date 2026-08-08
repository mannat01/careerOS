/**
 * Error-recovery renderer — the visual half of the recovery map.
 *
 * Per `frontend-architecture.md §9` + `docs/api-spec.md §2`, every
 * `ApiError.code` has a designed recovery affordance:
 *
 *   | code                  | affordance                                                   |
 *   |-----------------------|--------------------------------------------------------------|
 *   | unauthenticated       | re-auth CTA + retry                                          |
 *   | forbidden             | explanation ("you don't have access")                        |
 *   | not_found             | "we couldn't find that" + back link                          |
 *   | validation_failed     | inline field errors (from `err.details`)                     |
 *   | rate_limited          | backoff timer / upgrade path                                 |
 *   | capability_denied     | route to `<ApprovalDialog>` (approval CTA)                   |
 *   | source_not_allowed    | "send it yourself" guidance                                  |
 *   | conflict              | "resolve conflict" prompt with details                       |
 *   | internal              | apology + `traceId` + retry                                  |
 *
 * The guarantee the tests enforce (`frontend-milestone-01-workorder.md §9`
 * guarantee #6): **no code produces a silent no-op**. Every branch here
 * renders SOMETHING with a stable `data-recovery` attribute so tests can
 * assert affordance presence per code. The `recoveryForError` map from
 * `src/api/errors.ts` (Batch B) is exhaustiveness-checked at compile time;
 * this renderer switches on the resulting `ErrorRecovery.kind` — also
 * exhaustive, with an explicit `never` guard as a runtime tripwire.
 *
 * A11y contract:
 *   - Each rendered variant is wrapped in `role="alert"` so AT immediately
 *     announces the failure (assertive is appropriate for errors that
 *     block progress).
 *   - Actions are real `<button>`s with visible focus and keyboard
 *     operability; icon-only affordances have text labels.
 *   - Field-level errors (`validation_failed`) are rendered as a `<ul>`
 *     so structure is discoverable.
 */
import type { JSX } from 'react';
import { recoveryForError, type ApiError, type ErrorRecovery } from '../../api/errors';

export interface ErrorRecoveryRendererProps {
  readonly error: ApiError;
  /** Called when the user chooses to retry (backoff/internal/unauthenticated). */
  readonly onRetry?: () => void;
  /**
   * Called when the recovery routes to the approval flow (capability_denied).
   * Consumers should open the `<ApprovalDialog>` from `src/trust/` with the
   * appropriate action + payload.
   */
  readonly onRequestApproval?: (action: string | undefined) => void;
  /** Called when the user re-authenticates. */
  readonly onReauthenticate?: () => void;
  /** Called when the user acknowledges a conflict/resolve prompt. */
  readonly onResolveConflict?: (details: Readonly<Record<string, unknown>> | undefined) => void;
}

/** Renders the designed affordance for the given ApiError. */
export function ErrorRecoveryRenderer(props: ErrorRecoveryRendererProps): JSX.Element {
  const { error } = props;
  const recovery = recoveryForError(error);
  return renderRecovery(recovery, error, props);
}

/**
 * Pure switch over the recovery discriminated union. Exposed for testing
 * so a synthetic `ErrorRecovery` (e.g. one that does not correspond to an
 * ApiError) can be rendered directly to prove exhaustiveness.
 */
export function renderRecovery(
  recovery: ErrorRecovery,
  error: ApiError,
  handlers: Omit<ErrorRecoveryRendererProps, 'error'>,
): JSX.Element {
  switch (recovery.kind) {
    case 'reauthenticate':
      return (
        <section
          role="alert"
          data-testid="error-recovery"
          data-recovery="reauthenticate"
          data-code={error.code}
          className="rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm text-text-primary"
        >
          <h3 className="mb-1 font-semibold">Please sign in again</h3>
          <p className="mb-2 text-text-secondary">{error.message}</p>
          <button
            type="button"
            data-testid="error-recovery-action"
            onClick={handlers.onReauthenticate}
            className="rounded-md border border-brand-base bg-bg-subtle px-3 py-1 text-sm text-brand-base outline-none focus-visible:ring-2 focus-visible:ring-brand-base"
          >
            Sign in
          </button>
        </section>
      );

    case 'show_forbidden':
      return (
        <section
          role="alert"
          data-testid="error-recovery"
          data-recovery="show_forbidden"
          data-code={error.code}
          className="rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm text-text-primary"
        >
          <h3 className="mb-1 font-semibold">You don't have access</h3>
          <p className="text-text-secondary">{error.message}</p>
        </section>
      );

    case 'show_not_found':
      return (
        <section
          role="alert"
          data-testid="error-recovery"
          data-recovery="show_not_found"
          data-code={error.code}
          className="rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm text-text-primary"
        >
          <h3 className="mb-1 font-semibold">We couldn't find that</h3>
          <p className="text-text-secondary">{error.message}</p>
        </section>
      );

    case 'show_field_errors': {
      // Inline field errors — render one <li> per detail entry. The shape
      // of `err.details` is loosely typed at the contract level; we accept
      // record-of-string OR record-of-string[]. Missing/empty details are
      // still rendered as a bare "please review your input" message so we
      // never silently no-op.
      const entries = Object.entries(recovery.fields ?? {});
      return (
        <section
          role="alert"
          data-testid="error-recovery"
          data-recovery="show_field_errors"
          data-code={error.code}
          className="rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm text-text-primary"
        >
          <h3 className="mb-1 font-semibold">Please fix the highlighted fields</h3>
          <p className="mb-2 text-text-secondary">{error.message}</p>
          {entries.length > 0 ? (
            <ul className="ml-4 list-disc space-y-1" data-testid="error-recovery-fields">
              {entries.map(([field, msg]) => (
                <li key={field} data-testid={`error-field-${field}`}>
                  <strong>{field}:</strong> {formatFieldValue(msg)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-secondary" data-testid="error-recovery-fields-empty">
              Please review your input and try again.
            </p>
          )}
        </section>
      );
    }

    case 'backoff_and_retry': {
      const secs = recovery.retryAfterSeconds;
      const suffix =
        typeof secs === 'number' && Number.isFinite(secs) ? ` Try again in ${String(secs)}s.` : '';
      return (
        <section
          role="alert"
          data-testid="error-recovery"
          data-recovery="backoff_and_retry"
          data-code={error.code}
          className="rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm text-text-primary"
        >
          <h3 className="mb-1 font-semibold">We're going too fast</h3>
          <p className="mb-2 text-text-secondary">
            {error.message}
            {suffix}
          </p>
          <button
            type="button"
            data-testid="error-recovery-action"
            onClick={handlers.onRetry}
            className="rounded-md border border-brand-base bg-bg-subtle px-3 py-1 text-sm text-brand-base outline-none focus-visible:ring-2 focus-visible:ring-brand-base"
          >
            Retry
          </button>
        </section>
      );
    }

    case 'request_approval':
      return (
        <section
          role="alert"
          data-testid="error-recovery"
          data-recovery="request_approval"
          data-code={error.code}
          className="rounded-md border border-tier-yellow bg-bg-subtle p-3 text-sm text-text-primary"
        >
          <h3 className="mb-1 font-semibold">This action needs your approval</h3>
          <p className="mb-2 text-text-secondary">{error.message}</p>
          <button
            type="button"
            data-testid="error-recovery-action"
            onClick={() => handlers.onRequestApproval?.(recovery.action)}
            className="rounded-md border border-tier-yellow bg-tier-yellow px-3 py-1 text-sm font-medium text-text-inverse outline-none focus-visible:ring-2 focus-visible:ring-brand-base"
          >
            Review and approve
          </button>
        </section>
      );

    case 'explain_source_policy':
      return (
        <section
          role="alert"
          data-testid="error-recovery"
          data-recovery="explain_source_policy"
          data-code={error.code}
          className="rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm text-text-primary"
        >
          <h3 className="mb-1 font-semibold">We can't send this for you</h3>
          <p className="mb-2 text-text-secondary">
            {error.message}
            {recovery.source !== undefined ? ` (${recovery.source})` : ''}
          </p>
          <p className="text-text-secondary" data-testid="error-recovery-manual">
            Here's how to send it yourself — copy the composed message and use
            your own account on the platform.
          </p>
        </section>
      );

    case 'resolve_conflict':
      return (
        <section
          role="alert"
          data-testid="error-recovery"
          data-recovery="resolve_conflict"
          data-code={error.code}
          className="rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm text-text-primary"
        >
          <h3 className="mb-1 font-semibold">Someone else changed this</h3>
          <p className="mb-2 text-text-secondary">{error.message}</p>
          <button
            type="button"
            data-testid="error-recovery-action"
            onClick={() => handlers.onResolveConflict?.(recovery.details)}
            className="rounded-md border border-brand-base bg-bg-subtle px-3 py-1 text-sm text-brand-base outline-none focus-visible:ring-2 focus-visible:ring-brand-base"
          >
            Review changes
          </button>
        </section>
      );

    case 'show_trace_and_retry':
      return (
        <section
          role="alert"
          data-testid="error-recovery"
          data-recovery="show_trace_and_retry"
          data-code={error.code}
          className="rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm text-text-primary"
        >
          <h3 className="mb-1 font-semibold">Something went wrong on our side</h3>
          <p className="mb-2 text-text-secondary">{error.message}</p>
          {recovery.traceId !== undefined ? (
            <p className="mb-2 text-xs text-text-muted">
              Trace id: <code data-testid="error-recovery-trace">{recovery.traceId}</code>
            </p>
          ) : (
            <p className="mb-2 text-xs text-text-muted" data-testid="error-recovery-trace-missing">
              (no trace id was returned)
            </p>
          )}
          <button
            type="button"
            data-testid="error-recovery-action"
            onClick={handlers.onRetry}
            className="rounded-md border border-brand-base bg-bg-subtle px-3 py-1 text-sm text-brand-base outline-none focus-visible:ring-2 focus-visible:ring-brand-base"
          >
            Retry
          </button>
        </section>
      );

    default: {
      // Exhaustiveness tripwire — if `recovery.kind` is ever extended
      // without a matching branch here, TypeScript reports an error at
      // this `never` assignment AND we throw at runtime so a test can
      // assert we NEVER silently no-op for an unmapped affordance.
      const _exhaustive: never = recovery;
      throw new Error(
        `ErrorRecoveryRenderer: no affordance for recovery kind: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * Serialise a field-error value for the inline list. Accepts string,
 * string[], or arbitrary JSON — never renders `[object Object]`.
 */
function formatFieldValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ');
  if (v === null || v === undefined) return 'invalid';
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// `partial` briefing recovery (§9 "partial briefing → show composed + retry")
// `partial` is a briefing STATE, not an ApiError.code — we expose it as its
// own primitive so briefing surfaces can show what composed plus a retry
// button. Kept here alongside the other recovery paths for discoverability.
// ---------------------------------------------------------------------------

export interface PartialResultRecoveryProps {
  /** What already composed successfully — rendered as a small list. */
  readonly composed: readonly string[];
  /** The step that failed, so the user sees what to retry. */
  readonly failedStep: string;
  readonly message?: string;
  readonly onRetry?: () => void;
}

export function PartialResultRecovery({
  composed,
  failedStep,
  message = "One step failed — here's what we already have.",
  onRetry,
}: PartialResultRecoveryProps): JSX.Element {
  return (
    <section
      role="alert"
      data-testid="error-recovery"
      data-recovery="partial"
      className="rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm text-text-primary"
    >
      <h3 className="mb-1 font-semibold">Partial result</h3>
      <p className="mb-2 text-text-secondary">{message}</p>
      <ul className="mb-2 ml-4 list-disc space-y-1" data-testid="partial-composed">
        {composed.map((c, i) => (
          <li key={`partial-c-${String(i)}`}>{c}</li>
        ))}
      </ul>
      <p className="mb-2 text-xs text-text-muted">
        Failed step: <strong data-testid="partial-failed">{failedStep}</strong>
      </p>
      <button
        type="button"
        data-testid="error-recovery-action"
        onClick={onRetry}
        className="rounded-md border border-brand-base bg-bg-subtle px-3 py-1 text-sm text-brand-base outline-none focus-visible:ring-2 focus-visible:ring-brand-base"
      >
        Retry failed step
      </button>
    </section>
  );
}