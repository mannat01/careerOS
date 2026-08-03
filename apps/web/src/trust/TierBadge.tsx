import type { Tier } from './types.js';

/**
 * `<TierBadge tier>` — Green / Yellow / Red rendered as **icon + label +
 * color**, never color alone. Load-bearing per `frontend-architecture.md §5`.
 *
 * A11y notes:
 * - The badge is a plain inline element with an explicit textual label (not
 *   an aria-label alone) — screen readers announce "Tier: Yellow" without
 *   any live-region trickery.
 * - The icon is `aria-hidden` because the label already conveys meaning.
 * - Color comes from the shared `tier/*` design tokens via the Tailwind
 *   preset — no raw hex. When tokens change, all badges follow.
 * - Focus ring is only rendered when the badge is `interactive` (i.e. used
 *   as a control, e.g. inside a filter). Static badges are not focusable.
 */
export interface TierBadgeProps {
  readonly tier: Tier;
  /** Optional override label — defaults to "Green" / "Yellow" / "Red". */
  readonly label?: string;
  /** True when the badge is a control (filter chip); adds a focus ring. */
  readonly interactive?: boolean;
  /** Size preset. `sm` for inline cards, `md` for headings. */
  readonly size?: 'sm' | 'md';
  /** Optional class name to compose with the token-only base classes. */
  readonly className?: string;
}

const TIER_LABEL: Record<Tier, string> = {
  green: 'Green',
  yellow: 'Yellow',
  red: 'Red',
};

/** Icon glyphs are Unicode so a11y trees stay simple; screen readers ignore
 *  them because we set `aria-hidden`. They also convey meaning without color. */
const TIER_ICON: Record<Tier, string> = {
  green: '●', // filled — auto
  yellow: '▲', // caution — approve first
  red: '■', // stop — never automated
};

/** Semantic border/bg/text classes wired to the `tier/*` tokens. Never hex. */
const TIER_COLOR: Record<Tier, string> = {
  green: 'border-tier-green text-tier-green bg-bg-subtle',
  yellow: 'border-tier-yellow text-tier-yellow bg-bg-subtle',
  red: 'border-tier-red text-tier-red bg-bg-subtle',
};

export function TierBadge({
  tier,
  label,
  interactive = false,
  size = 'sm',
  className,
}: TierBadgeProps): JSX.Element {
  const text = label ?? TIER_LABEL[tier];
  const paddingClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  const focusClass = interactive
    ? 'outline-none focus-visible:ring-2 focus-visible:ring-brand-base'
    : '';
  const classes = [
    'inline-flex items-center gap-1 rounded-full border font-medium',
    paddingClass,
    TIER_COLOR[tier],
    focusClass,
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      role="status"
      aria-label={`Tier: ${text}`}
      data-tier={tier}
      data-testid="tier-badge"
      className={classes}
      tabIndex={interactive ? 0 : undefined}
    >
      <span aria-hidden="true" data-testid="tier-icon">
        {TIER_ICON[tier]}
      </span>
      <span data-testid="tier-label">{text}</span>
    </span>
  );
}