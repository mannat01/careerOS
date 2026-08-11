import type { Provenance } from './types.js';

/**
 * `<ProvenanceTag provenance>` — every profile fact must declare where it
 * came from. Per `frontend-architecture.md §5`, one of:
 *   - `imported`             — parsed from résumé / LinkedIn / import
 *   - `user`                 — the user typed it
 *   - `inferred_confirmed`   — CIE inferred, then user confirmed
 *   - `from_notes`           — pulled from the user's PKM/notes
 *
 * The tag is text-first (never icon-only) so screen readers announce a
 * label — a screen-reader user should be able to audit provenance the same
 * way a sighted user does.
 */
export interface ProvenanceTagProps {
  readonly provenance: Provenance;
  /** Verbatim source text for imported facts. Never summarized or rewritten. */
  readonly quote?: string;
  readonly className?: string;
}

const PROV_LABEL: Record<Provenance, string> = {
  imported: 'Imported',
  user: 'You added',
  inferred_confirmed: 'AI — confirmed',
  from_notes: 'From your notes',
  no_signal: 'No signal yet',
};

/** Small tokens describe the *category*, not decoration. Text says it all,
 *  the color is a redundant cue. All classes token-based. */
const PROV_COLOR: Record<Provenance, string> = {
  imported: 'border-border-strong text-text-secondary',
  user: 'border-brand-base text-brand-base',
  inferred_confirmed: 'border-confidence-high text-confidence-high',
  from_notes: 'border-confidence-med text-confidence-med',
  no_signal: 'border-border-subtle text-text-secondary',
};

export function ProvenanceTag({
  provenance,
  quote,
  className,
}: ProvenanceTagProps): JSX.Element {
  const label = PROV_LABEL[provenance];
  const classes = [
    'inline-flex rounded-md border bg-bg-subtle px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide',
    quote === undefined ? 'items-center' : 'flex-col items-start gap-1',
    PROV_COLOR[provenance],
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      role="note"
      aria-label={
        quote === undefined
          ? `Provenance: ${label}`
          : `Provenance: ${label}. Verbatim résumé quote: ${quote}`
      }
      data-provenance={provenance}
      data-testid="provenance-tag"
      className={classes}
    >
      <span>{label}</span>
      {quote === undefined ? null : (
        <q
          className="font-normal normal-case tracking-normal text-text-primary"
          data-testid="provenance-quote"
        >
          {quote}
        </q>
      )}
    </span>
  );
}
