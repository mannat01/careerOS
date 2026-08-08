import { useEffect, useId, useRef, useState } from 'react';
import type { Evidence, Subject } from './types';

/**
 * `<WhyPopover subject evidence[] reasoning>` — the universal "why."
 *
 * Per `frontend-architecture.md §5`, any score, insight, metric, plan action,
 * or recommendation MUST be wrapped in this: the user can always ask why,
 * inspect the evidence, and drill down. Evidence refs are resolvable pointers.
 *
 * A11y contract:
 * - Trigger is a real `<button>` with `aria-expanded` and `aria-controls`.
 * - Popover has `role="dialog"` + `aria-labelledby` referencing the subject
 *   heading; content is focusable so screen readers land in it after open.
 * - Escape closes and returns focus to the trigger.
 * - Clicking outside also closes (mouse users).
 *
 * The component is *presentational* — it does not fetch evidence; callers
 * pass hydrated `Evidence[]` from the API. Empty evidence renders the
 * "not enough signal yet" text (never a fake "0 pieces of evidence").
 */
export interface WhyPopoverProps {
  readonly subject: Subject;
  readonly evidence: readonly Evidence[];
  readonly reasoning: string;
  /** Visible label on the trigger. Defaults to "Why?". */
  readonly triggerLabel?: string;
  /** Optional class name for the trigger. */
  readonly className?: string;
}

export function WhyPopover({
  subject,
  evidence,
  reasoning,
  triggerLabel = 'Why?',
  className,
}: WhyPopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const popoverId = useId();
  const headingId = `${popoverId}-heading`;

  // Escape-key + click-outside close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onDown(e: MouseEvent): void {
      const target = e.target as Node | null;
      if (
        target &&
        !popoverRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  // Move focus into the popover when it opens so screen readers announce it.
  useEffect(() => {
    if (open) {
      popoverRef.current?.focus();
    }
  }, [open]);

  const triggerClasses = [
    'inline-flex items-center rounded-md border border-border-subtle bg-bg-subtle px-2 py-0.5 text-xs font-medium text-text-secondary',
    'outline-none focus-visible:ring-2 focus-visible:ring-brand-base hover:border-border-strong',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-haspopup="dialog"
        data-testid="why-trigger"
        className={triggerClasses}
        onClick={() => setOpen((v) => !v)}
      >
        {triggerLabel}
      </button>

      {open ? (
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-labelledby={headingId}
          data-testid="why-popover"
          tabIndex={-1}
          className="absolute z-10 mt-1 w-80 rounded-lg border border-border-subtle bg-bg-elevated p-3 text-sm text-text-primary shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-base"
        >
          <h3 id={headingId} className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
            Why: {subject.label}
          </h3>
          <p className="mb-2 text-text-primary" data-testid="why-reasoning">
            {reasoning}
          </p>

          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Evidence
          </div>
          {evidence.length === 0 ? (
            <p className="text-text-muted" data-testid="why-no-evidence">
              Not enough signal yet.
            </p>
          ) : (
            <ul className="space-y-1" data-testid="why-evidence-list">
              {evidence.map((e) => (
                <li key={e.id} className="rounded border border-border-subtle bg-bg-subtle p-2">
                  <div className="text-[11px] uppercase tracking-wide text-text-muted">
                    {e.source}
                  </div>
                  <div className="text-text-primary">{e.snippet}</div>
                  {e.url ? (
                    <a
                      href={e.url}
                      className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open source
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </span>
  );
}