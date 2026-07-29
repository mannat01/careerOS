/**
 * CareerOS design tokens — the SOURCE OF TRUTH.
 *
 * Everything visual in `apps/web` should reference these tokens (via the
 * shared CSS variables + Tailwind preset in this package). Never hard-code
 * hex in application code. See `docs/design-system.md` §2 for rationale.
 *
 * Palette rationale:
 * - Neutrals: cool-grey scale that reads calm and modern (Linear/Vercel).
 * - Brand: blue-600 base with darker emphasis; conservative — no brand
 *   assumption is baked in for FM1.
 * - Tier: green/amber/red hues **carefully picked** so text-on-base and
 *   base-on-white/base-on-dark both meet WCAG AA (≥4.5:1 for text,
 *   ≥3:1 for UI). Enforced by `tokens.contrast.test.ts`.
 * - Confidence: same discipline as tier — the low/med/high bands double as
 *   evidence colors and MUST clear AA in both themes.
 */

/** All semantic token keys the UI knows about. Adding a key here forces the
 *  CSS + Tailwind preset to stay in sync (compile error if you forget). */
export type TokenKey =
  | 'bg.base'
  | 'bg.subtle'
  | 'bg.elevated'
  | 'border.subtle'
  | 'border.strong'
  | 'text.primary'
  | 'text.secondary'
  | 'text.muted'
  | 'text.inverse'
  | 'brand.base'
  | 'brand.emphasis'
  | 'brand.subtle'
  | 'status.success'
  | 'status.warning'
  | 'status.danger'
  | 'status.info'
  | 'tier.green'
  | 'tier.yellow'
  | 'tier.red'
  | 'confidence.low'
  | 'confidence.med'
  | 'confidence.high'
  | 'focus.ring';

export type Theme = 'light' | 'dark';

/** Hex values per theme. Kept in this module so the contrast test can import
 *  them without parsing CSS. `tokens.css` MUST be regenerated from these. */
export const tokens: Record<Theme, Record<TokenKey, string>> = {
  light: {
    'bg.base': '#ffffff',
    'bg.subtle': '#f7f8fa',
    'bg.elevated': '#ffffff',
    'border.subtle': '#e4e7eb',
    'border.strong': '#cbd2d9',
    'text.primary': '#0f172a',
    'text.secondary': '#334155',
    'text.muted': '#64748b',
    'text.inverse': '#ffffff',
    'brand.base': '#1d4ed8',
    'brand.emphasis': '#1e40af',
    'brand.subtle': '#dbeafe',
    'status.success': '#15803d',
    'status.warning': '#b45309',
    'status.danger': '#b91c1c',
    'status.info': '#1d4ed8',
    // Tier — chosen for ≥4.5:1 on bg.base (white). Tier is load-bearing:
    // it's the user's mental model of the autonomy boundary.
    'tier.green': '#15803d',
    'tier.yellow': '#b45309',
    'tier.red': '#b91c1c',
    // Confidence — mirrors tier hues but uses distinct chroma so a screen
    // reader user hears the label ("low/med/high") and sighted users don't
    // confuse it with a tier chip. Values meet AA on bg.base.
    'confidence.low': '#b45309',
    'confidence.med': '#4338ca',
    'confidence.high': '#15803d',
    'focus.ring': '#2563eb',
  },
  dark: {
    'bg.base': '#0b1220',
    'bg.subtle': '#111a2e',
    'bg.elevated': '#172033',
    'border.subtle': '#1f2a44',
    'border.strong': '#334155',
    'text.primary': '#f8fafc',
    'text.secondary': '#cbd5e1',
    'text.muted': '#94a3b8',
    'text.inverse': '#0f172a',
    'brand.base': '#93c5fd',
    'brand.emphasis': '#bfdbfe',
    'brand.subtle': '#1e3a8a',
    'status.success': '#4ade80',
    'status.warning': '#fbbf24',
    'status.danger': '#f87171',
    'status.info': '#93c5fd',
    'tier.green': '#4ade80',
    'tier.yellow': '#fbbf24',
    'tier.red': '#fca5a5',
    'confidence.low': '#fbbf24',
    'confidence.med': '#c4b5fd',
    'confidence.high': '#4ade80',
    'focus.ring': '#93c5fd',
  },
};

/** CSS custom-property name for a token — the ONLY thing components should
 *  ever depend on (via the Tailwind preset, not raw). */
export function cssVar(key: TokenKey): string {
  return `--co-${key.replace('.', '-')}`;
}

/** Motion tokens — durations. Keys map to Tailwind's `transitionDuration`. */
export const motion = {
  fast: '120ms',
  base: '200ms',
  slow: '320ms',
} as const;

/** Spacing base (4px). Downstream Tailwind uses its default scale, which is
 *  already 4px-based; this constant documents the invariant. */
export const spacingBasePx = 4;

/** Radius tokens (px) — matches `docs/design-system.md` §2. */
export const radius = {
  sm: '4px',
  md: '6px',
  lg: '10px',
  xl: '16px',
  full: '9999px',
} as const;