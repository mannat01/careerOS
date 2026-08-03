import type { Confidence } from './types.js';

/**
 * `<ConfidenceChip confidence source>` — the calibrated band + value.
 *
 * Per `frontend-architecture.md §5`: this always shows the *band* first
 * ("Low/Med/High") and the numeric value second, because a lone probability
 * is misleading without a discrete band. Both must be visible; the color
 * cue is decorative, never load-bearing on its own.
 *
 * The chip is a link — it navigates to `/you/calibration#{source}` so users
 * can inspect calibration honesty. `to` is overrideable for embedding in
 * other routes (e.g. per-metric calibration).
 */
export interface ConfidenceChipProps {
  readonly confidence: Confidence;
  /** Route the chip links to. Defaults to the calibration room anchor. */
  readonly to?: string;
  /** Optional class name to compose with the token base. */
  readonly className?: string;
}

const BAND_LABEL: Record<Confidence['band'], string> = {
  low: 'Low',
  med: 'Med',
  high: 'High',
};

const BAND_COLOR: Record<Confidence['band'], string> = {
  low: 'border-confidence-low text-confidence-low',
  med: 'border-confidence-med text-confidence-med',
  high: 'border-confidence-high text-confidence-high',
};

/** Format 0..1 → percentage, no trailing decimals for a compact chip. */
function fmtPct(v: number): string {
  const clamped = Math.max(0, Math.min(1, v));
  return `${Math.round(clamped * 100)}%`;
}

export function ConfidenceChip({
  confidence,
  to,
  className,
}: ConfidenceChipProps): JSX.Element {
  const { band, value, source } = confidence;
  const href = to ?? `/you/calibration#${encodeURIComponent(source)}`;
  const label = BAND_LABEL[band];
  const pct = fmtPct(value);

  const classes = [
    'inline-flex items-center gap-1 rounded-full border bg-bg-subtle px-2 py-0.5 text-xs font-medium',
    'outline-none focus-visible:ring-2 focus-visible:ring-brand-base',
    BAND_COLOR[band],
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <a
      href={href}
      role="link"
      aria-label={`Confidence: ${label}, ${pct}. Source: ${source}. Open calibration.`}
      data-band={band}
      data-testid="confidence-chip"
      className={classes}
    >
      <span data-testid="confidence-band">{label}</span>
      <span aria-hidden="true">·</span>
      <span data-testid="confidence-value">{pct}</span>
    </a>
  );
}