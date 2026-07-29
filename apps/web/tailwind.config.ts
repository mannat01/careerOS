import type { Config } from 'tailwindcss';

/**
 * apps/web Tailwind config.
 *
 * Tokens live in `@careeros/ui` (via CSS variables in `app/globals.css`).
 * This config only wires Tailwind theme names → CSS variables so app code
 * never touches raw colors (see docs/design-system.md §2).
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: 'var(--co-bg-base)',
          subtle: 'var(--co-bg-subtle)',
          elevated: 'var(--co-bg-elevated)',
        },
        border: {
          subtle: 'var(--co-border-subtle)',
          strong: 'var(--co-border-strong)',
        },
        text: {
          primary: 'var(--co-text-primary)',
          secondary: 'var(--co-text-secondary)',
          muted: 'var(--co-text-muted)',
          inverse: 'var(--co-text-inverse)',
        },
        brand: {
          base: 'var(--co-brand-base)',
          emphasis: 'var(--co-brand-emphasis)',
          subtle: 'var(--co-brand-subtle)',
        },
        // Autonomy tier semantics (load-bearing — see design-system.md §2).
        tier: {
          green: 'var(--co-tier-green)',
          yellow: 'var(--co-tier-yellow)',
          red: 'var(--co-tier-red)',
        },
        // Confidence band semantics for calibrated CIE outputs.
        confidence: {
          low: 'var(--co-confidence-low)',
          med: 'var(--co-confidence-med)',
          high: 'var(--co-confidence-high)',
        },
      },
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
        slow: '320ms',
      },
    },
  },
  plugins: [],
};

export default config;