/**
 * Task 7 (FM1 Batch D2) — state/loading/error primitives unit + a11y tests.
 *
 * Guarantee-relevant coverage:
 *
 * 1. **Every `ApiError.code` renders a recovery affordance** — no silent
 *    no-op (`docs/frontend-milestone-01-workorder.md §9` guarantee #6).
 *    We iterate all 9 codes from `@careeros/contracts.errorCodeEnum` and
 *    assert `[data-testid="error-recovery"]` is present with the correct
 *    `data-recovery` variant and `data-code`.
 *
 * 2. **Exhaustiveness** — an unmapped/synthetic `ErrorRecovery.kind`
 *    passed directly to `renderRecovery` throws a loud runtime error via
 *    the `never` tripwire. This is the load-bearing rule that guarantees
 *    a future added code cannot silently no-op.
 *
 * 3. **A11y** — every rendered state (skeletons, live region, each of the
 *    9 recovery variants) is axe-clean.
 *
 * 4. **Optimistic helper** — applies the patch synchronously, commits +
 *    merges on success, rolls back + re-throws on failure with a typed
 *    `ApiError` so the recovery renderer path always has something to
 *    consume (no swallowed errors from the optimistic layer either).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { errorCodeSchema, type ErrorCode } from '@careeros/contracts';

import { RouteSkeleton, ListSkeleton } from './Skeleton';
import {
  LiveRegion,
  StreamingLiveRegion,
  announcePolitely,
  announceAssertively,
  _resetLiveRegionForTests,
} from './LiveRegion';
import { runOptimistic, buildOptimistic } from './optimistic';
import {
  ErrorRecoveryRenderer,
  PartialResultRecovery,
  renderRecovery,
} from './ErrorRecovery';
import { ApiError, type ErrorRecovery } from '../../api/errors';

beforeEach(() => {
  cleanup();
  _resetLiveRegionForTests();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

describe('<RouteSkeleton>', () => {
  it('renders a polite live region with a visible label', () => {
    render(<RouteSkeleton />);
    const region = screen.getByTestId('route-skeleton');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('route-skeleton-label')).toHaveTextContent(/Loading/i);
  });

  it('is axe-clean', async () => {
    const { container } = render(<RouteSkeleton />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('<ListSkeleton>', () => {
  it('renders N row placeholders (default 3)', () => {
    render(<ListSkeleton />);
    expect(screen.getAllByTestId('list-skeleton-row')).toHaveLength(3);
  });

  it('clamps row count to [1, 20]', () => {
    const { rerender } = render(<ListSkeleton rows={0} />);
    expect(screen.getAllByTestId('list-skeleton-row')).toHaveLength(1);
    rerender(<ListSkeleton rows={999} />);
    expect(screen.getAllByTestId('list-skeleton-row')).toHaveLength(20);
  });

  it('is axe-clean', async () => {
    const { container } = render(<ListSkeleton rows={5} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

// ---------------------------------------------------------------------------
// LiveRegion
// ---------------------------------------------------------------------------

describe('<LiveRegion>', () => {
  it('renders polite by default with aria-live=polite and role=status', () => {
    render(<LiveRegion messages={['hello']} />);
    const region = screen.getByTestId('live-region');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-atomic', 'false');
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders assertive with role=alert when politeness=assertive', () => {
    render(<LiveRegion messages={['nope']} politeness="assertive" />);
    const region = screen.getByTestId('live-region');
    expect(region).toHaveAttribute('aria-live', 'assertive');
    expect(region).toHaveAttribute('role', 'alert');
  });

  it('filters empty messages (never announces "")', () => {
    render(<LiveRegion messages={['', 'a', '', 'b']} />);
    const msgs = screen.getAllByTestId('live-region-msg');
    expect(msgs).toHaveLength(2);
  });

  it('is always mounted even with zero messages', () => {
    render(<LiveRegion messages={[]} />);
    expect(screen.getByTestId('live-region')).toBeInTheDocument();
  });

  it('is axe-clean when visible', async () => {
    const { container } = render(<LiveRegion messages={['streaming …']} visible />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('StreamingLiveRegion + announcers', () => {
  it('announcePolitely appends to the polite region', () => {
    render(<StreamingLiveRegion />);
    act(() => {
      announcePolitely('composing step 1');
    });
    expect(screen.getByTestId('streaming-live-polite')).toHaveTextContent('composing step 1');
    expect(screen.getByTestId('streaming-live-assertive')).toHaveTextContent('');
  });

  it('announceAssertively appends to the assertive region', () => {
    render(<StreamingLiveRegion />);
    act(() => {
      announceAssertively('connection lost');
    });
    expect(screen.getByTestId('streaming-live-assertive')).toHaveTextContent('connection lost');
  });

  it('ignores empty announcements', () => {
    render(<StreamingLiveRegion />);
    act(() => {
      announcePolitely('');
      announceAssertively('');
    });
    expect(screen.queryAllByTestId('streaming-live-polite-msg')).toHaveLength(0);
    expect(screen.queryAllByTestId('streaming-live-assertive-msg')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Optimistic mutation
// ---------------------------------------------------------------------------

describe('runOptimistic', () => {
  it('applies patch synchronously and merges server truth on success', async () => {
    const setState = vi.fn((_next: { n: number }): void => {});
    const result = await runOptimistic(
      buildOptimistic<{ n: number }, { n: number }>({
        snapshot: { n: 1 },
        patch: (s) => ({ n: s.n + 1 }),
        commit: async () => Promise.resolve({ n: 42 }),
        setState,
      }),
    );
    expect(result).toEqual({ kind: 'ok', response: { n: 42 } });
    // Called at least twice: once with optimistic {n:2}, once with server {n:42}.
    const calls = setState.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ n: 2 });
    expect(calls[calls.length - 1]).toEqual({ n: 42 });
  });

  it('rolls back to snapshot and re-throws typed ApiError on failure', async () => {
    const setState = vi.fn((_next: { n: number }): void => {});
    const boom = new ApiError({
      code: 'capability_denied',
      message: 'nope',
      details: { action: 'send-email' },
    });
    await expect(
      runOptimistic(
        buildOptimistic<{ n: number }, { n: number }>({
          snapshot: { n: 1 },
          patch: (s) => ({ n: s.n + 1 }),
          commit: async () => Promise.reject(boom),
          setState,
        }),
      ),
    ).rejects.toBeInstanceOf(ApiError);

    const calls = setState.mock.calls.map((c) => c[0]);
    // Optimistic applied first, then rollback to snapshot.
    expect(calls).toContainEqual({ n: 2 });
    expect(calls[calls.length - 1]).toEqual({ n: 1 });
  });

  it('wraps plain Error failures into a typed `internal` ApiError so the recovery renderer always has something to map', async () => {
    const setState = vi.fn((_next: { n: number }): void => {});
    try {
      await runOptimistic(
        buildOptimistic<{ n: number }, { n: number }>({
          snapshot: { n: 1 },
          patch: (s) => ({ n: s.n + 1 }),
          commit: async () => Promise.reject(new Error('network')),
          setState,
        }),
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('internal');
    }
  });
});

// ---------------------------------------------------------------------------
// ErrorRecoveryRenderer — one test per ApiError.code (guarantee #6)
// ---------------------------------------------------------------------------

/**
 * Deterministic factory for an ApiError whose recovery variant is
 * well-populated with `details` so the affordance renders the full
 * variant (fields, retryAfterSeconds, action, source, traceId).
 */
function makeErrorForCode(code: ErrorCode): ApiError {
  switch (code) {
    case 'unauthenticated':
      return new ApiError({ code, message: 'sign in required' });
    case 'forbidden':
      return new ApiError({ code, message: "you can't do this" });
    case 'not_found':
      return new ApiError({ code, message: 'missing' });
    case 'validation_failed':
      return new ApiError({
        code,
        message: 'invalid input',
        details: { title: 'required', email: ['must be email'] },
      });
    case 'rate_limited':
      return new ApiError({
        code,
        message: 'too many requests',
        details: { retryAfterSeconds: 30 },
      });
    case 'capability_denied':
      return new ApiError({
        code,
        message: 'approval required',
        details: { action: 'send-outreach' },
      });
    case 'source_not_allowed':
      return new ApiError({
        code,
        message: 'ToS forbids automation',
        details: { source: 'linkedin' },
      });
    case 'conflict':
      return new ApiError({
        code,
        message: 'someone else changed it',
        details: { version: 3 },
      });
    case 'internal':
      return new ApiError({ code, message: 'oh no', traceId: 'trace-abc123' });
    default: {
      // If a new code lands in @careeros/contracts, this exhaustiveness
      // guard fails the build until the factory is extended.
      const _: never = code;
      throw new Error(`missing factory for ${String(_)}`);
    }
  }
}

/** Expected `data-recovery` variant for each code. */
const EXPECTED_VARIANT: Record<ErrorCode, string> = {
  unauthenticated: 'reauthenticate',
  forbidden: 'show_forbidden',
  not_found: 'show_not_found',
  validation_failed: 'show_field_errors',
  rate_limited: 'backoff_and_retry',
  capability_denied: 'request_approval',
  source_not_allowed: 'explain_source_policy',
  conflict: 'resolve_conflict',
  internal: 'show_trace_and_retry',
};

// Iterate the ACTUAL enum values from @careeros/contracts so that adding
// a new ErrorCode without updating the renderer fails these tests loudly.
const ALL_CODES: readonly ErrorCode[] = errorCodeSchema.options;

describe('<ErrorRecoveryRenderer> — every ApiError.code renders an affordance (guarantee #6)', () => {
  it('coverage: enumerates all codes exported by @careeros/contracts', () => {
    // Sanity check — the factory + expected-variant map must cover every code.
    for (const code of ALL_CODES) {
      expect(EXPECTED_VARIANT[code]).toBeDefined();
      makeErrorForCode(code);
    }
    // If contracts ever adds a new code, at least one of the below explicit
    // per-code tests will fail because the switch will not have a branch.
    expect(ALL_CODES.length).toBeGreaterThanOrEqual(9);
  });

  it.each(ALL_CODES)('code=%s renders a non-empty recovery affordance', (code) => {
    const err = makeErrorForCode(code);
    render(<ErrorRecoveryRenderer error={err} />);
    const el = screen.getByTestId('error-recovery');
    expect(el).toHaveAttribute('data-code', code);
    expect(el).toHaveAttribute('data-recovery', EXPECTED_VARIANT[code]);
    // Not a silent no-op — the element has visible text content.
    expect((el.textContent ?? '').trim().length).toBeGreaterThan(0);
    // role=alert so AT is guaranteed to announce it.
    expect(el).toHaveAttribute('role', 'alert');
  });

  it.each(ALL_CODES)('code=%s is axe-clean', async (code) => {
    const err = makeErrorForCode(code);
    const { container } = render(<ErrorRecoveryRenderer error={err} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('capability_denied → routes to approval (invokes onRequestApproval with the action)', () => {
    const onRequestApproval = vi.fn((_action: string | undefined): void => {});
    const err = makeErrorForCode('capability_denied');
    render(<ErrorRecoveryRenderer error={err} onRequestApproval={onRequestApproval} />);
    fireEvent.click(screen.getByTestId('error-recovery-action'));
    expect(onRequestApproval).toHaveBeenCalledWith('send-outreach');
  });

  it('source_not_allowed → renders "send it yourself" guidance', () => {
    const err = makeErrorForCode('source_not_allowed');
    render(<ErrorRecoveryRenderer error={err} />);
    expect(screen.getByTestId('error-recovery-manual')).toBeInTheDocument();
    expect(screen.getByTestId('error-recovery')).toHaveTextContent(/linkedin/);
  });

  it('validation_failed → renders inline field errors', () => {
    const err = makeErrorForCode('validation_failed');
    render(<ErrorRecoveryRenderer error={err} />);
    expect(screen.getByTestId('error-field-title')).toHaveTextContent(/required/);
    expect(screen.getByTestId('error-field-email')).toHaveTextContent(/must be email/);
  });

  it('rate_limited → shows backoff hint from retryAfterSeconds and fires onRetry', () => {
    const onRetry = vi.fn();
    const err = makeErrorForCode('rate_limited');
    render(<ErrorRecoveryRenderer error={err} onRetry={onRetry} />);
    expect(screen.getByTestId('error-recovery')).toHaveTextContent(/30s/);
    fireEvent.click(screen.getByTestId('error-recovery-action'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('unauthenticated → invokes onReauthenticate', () => {
    const onReauthenticate = vi.fn();
    const err = makeErrorForCode('unauthenticated');
    render(<ErrorRecoveryRenderer error={err} onReauthenticate={onReauthenticate} />);
    fireEvent.click(screen.getByTestId('error-recovery-action'));
    expect(onReauthenticate).toHaveBeenCalledOnce();
  });

  it('internal → shows traceId and fires onRetry', () => {
    const onRetry = vi.fn();
    const err = makeErrorForCode('internal');
    render(<ErrorRecoveryRenderer error={err} onRetry={onRetry} />);
    expect(screen.getByTestId('error-recovery-trace')).toHaveTextContent('trace-abc123');
    fireEvent.click(screen.getByTestId('error-recovery-action'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('internal without traceId — still renders a labelled placeholder (never silent)', () => {
    const err = new ApiError({ code: 'internal', message: 'oops' });
    render(<ErrorRecoveryRenderer error={err} />);
    expect(screen.getByTestId('error-recovery-trace-missing')).toBeInTheDocument();
  });

  it('validation_failed with no details — still renders a fallback (never silent)', () => {
    const err = new ApiError({ code: 'validation_failed', message: 'bad' });
    render(<ErrorRecoveryRenderer error={err} />);
    expect(screen.getByTestId('error-recovery-fields-empty')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Exhaustiveness — an unmapped ErrorRecovery.kind fails loudly.
// ---------------------------------------------------------------------------

describe('renderRecovery exhaustiveness (guarantee #6, negative)', () => {
  it('throws loudly for an unmapped/new recovery kind — never a silent no-op', () => {
    // Simulate a future ErrorRecovery variant added to the union but not
    // handled in the renderer. We intentionally cast to bypass the compile-
    // time check so the RUNTIME `never` tripwire is what we're testing.
    const bogus = { kind: 'not_yet_designed' } as unknown as ErrorRecovery;
    expect(() =>
      renderRecovery(bogus, new ApiError({ code: 'internal', message: 'x' }), {}),
    ).toThrow(/no affordance for recovery kind/);
  });
});

// ---------------------------------------------------------------------------
// Partial-result recovery — the `partial` briefing state (§9)
// ---------------------------------------------------------------------------

describe('<PartialResultRecovery>', () => {
  it('renders composed steps + failed step + retry button', () => {
    const onRetry = vi.fn();
    render(
      <PartialResultRecovery
        composed={['scored', 'drafted']}
        failedStep="sent"
        onRetry={onRetry}
      />,
    );
    const composed = screen.getByTestId('partial-composed');
    expect(composed).toHaveTextContent('scored');
    expect(composed).toHaveTextContent('drafted');
    expect(screen.getByTestId('partial-failed')).toHaveTextContent('sent');
    fireEvent.click(screen.getByTestId('error-recovery-action'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('is axe-clean', async () => {
    const { container } = render(
      <PartialResultRecovery composed={['a', 'b']} failedStep="c" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});