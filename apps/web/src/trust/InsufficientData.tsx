/**
 * `<InsufficientData reason next>` — "not enough signal yet" + how to build it.
 *
 * Per `frontend-architecture.md §5`: the UI must **never** hallucinate a
 * number when there isn't enough evidence. This component is the honest
 * alternative — it names the missing signal (`reason`) and lists the exact
 * steps the user can take to unlock it (`next`).
 *
 * Rendering rules:
 * - The component NEVER shows a numeric score, band, or percentage — it is
 *   the anti-metric. If a caller has partial signal, they should use
 *   `<ConfidenceChip>` with band=low; this component is reserved for zero.
 * - The steps are keyboard-accessible: each step is an ordered list item so
 *   screen readers announce position ("1 of 3").
 * - Uses `role="status"` (polite) rather than an alert, because empty state
 *   is not an error — it's a normal early-lifecycle condition.
 */
export interface InsufficientDataStep {
  readonly id: string;
  readonly label: string;
  /** Optional href for step actions that resolve in the app. */
  readonly href?: string;
}

export interface InsufficientDataProps {
  /** Human sentence describing what's missing. */
  readonly reason: string;
  /** Ordered steps the user can take next. */
  readonly next: readonly InsufficientDataStep[];
  /** Optional heading (defaults to "Not enough signal yet"). */
  readonly heading?: string;
  /** Semantic heading level for the host surface (defaults to 3). */
  readonly headingLevel?: 2 | 3;
  readonly className?: string;
}

export function InsufficientData({
  reason,
  next,
  heading = 'Not enough signal yet',
  headingLevel = 3,
  className,
}: InsufficientDataProps): JSX.Element {
  const classes = [
    'rounded-lg border border-border-subtle bg-bg-subtle p-4 text-sm text-text-primary',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  return (
    <section
      role="status"
      aria-live="polite"
      data-testid="insufficient-data"
      className={classes}
    >
      <Heading className="mb-1 text-sm font-semibold text-text-primary">{heading}</Heading>
      <p className="mb-3 text-text-secondary" data-testid="insufficient-reason">
        {reason}
      </p>
      {next.length > 0 ? (
        <>
          <div
            className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary"
            data-testid="insufficient-next-label"
          >
            How to build it
          </div>
          <ol
            className="ml-4 list-decimal space-y-1"
            data-testid="insufficient-steps"
          >
            {next.map((step) => (
              <li key={step.id} className="text-text-primary">
                {step.href ? (
                  <a
                    href={step.href}
                    className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base"
                  >
                    {step.label}
                  </a>
                ) : (
                  step.label
                )}
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}