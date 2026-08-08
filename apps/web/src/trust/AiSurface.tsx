import type { ReactNode } from 'react';
import type { Confidence, Evidence, Tier } from './types';

/**
 * `<AiSurface>` — the *structural discipline* every AI-produced surface
 * MUST wrap. Per `frontend-architecture.md §5`, omitting evidence or
 * confidence at a call-site is a compile error. This is the same trick
 * `unsafe_brandApprovalToken` uses: type structure carries the promise
 * that the caller has done the right thing.
 *
 * The load-bearing rule is that `evidence` and `confidence` are **required
 * props with no defaults**. TypeScript infers `AiSurfaceProps` from the
 * function signature; because both fields are `readonly` (not optional),
 * consumers cannot elide them without triggering `TS2741`.
 *
 * The type-level proof lives in `AiSurface.compile-fail.test-d.ts`, which
 * uses `@ts-expect-error` to *require* the compiler to reject a missing
 * `evidence`/`confidence`. If a future refactor accidentally makes those
 * fields optional, that test-file stops emitting a diagnostic and vitest's
 * `tsc --noEmit` check fails — same technique as
 * `apps/web/src/api/approval.test.ts`.
 *
 * `tier` is optional because not every AI surface is an action (a "why"
 * on a metric doesn't need tiering); when supplied, the surface renders
 * it as a data attribute + a11y label so downstream chrome (badge, dialog)
 * can pick it up without prop-drilling.
 */
export interface AiSurfaceProps {
  /** Evidence backing the AI output. Required — no default. */
  readonly evidence: readonly Evidence[];
  /** Calibrated confidence (band + value + source). Required — no default. */
  readonly confidence: Confidence;
  /** Autonomy tier — required only for surfaces that gate an action. */
  readonly tier?: Tier;
  /** The surface content — the actual AI-produced UI (score, insight, …). */
  readonly children: ReactNode;
  /** Optional accessible label describing the surface as a whole. */
  readonly label?: string;
  readonly className?: string;
}

export function AiSurface({
  evidence,
  confidence,
  tier,
  children,
  label,
  className,
}: AiSurfaceProps): JSX.Element {
  const classes = ['ai-surface', className ?? ''].filter(Boolean).join(' ');
  return (
    <section
      data-testid="ai-surface"
      data-evidence-count={evidence.length}
      data-confidence-band={confidence.band}
      data-confidence-source={confidence.source}
      data-tier={tier ?? undefined}
      aria-label={label ?? 'AI output'}
      className={classes}
    >
      {children}
    </section>
  );
}