import type { Config } from 'tailwindcss';
import { motion, radius } from './tokens.js';

/**
 * Shared Tailwind preset — wires theme names to the CSS variables emitted by
 * `tokens.css`. Any app using `@careeros/ui` should extend this preset so the
 * `bg-tier-yellow` / `text-confidence-high` / etc. class names stay
 * consistent everywhere and drift-proof from the source-of-truth tokens.
 */
export const uiPreset = {
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
        status: {
          success: 'var(--co-status-success)',
          warning: 'var(--co-status-warning)',
          danger: 'var(--co-status-danger)',
          info: 'var(--co-status-info)',
        },
        // Load-bearing autonomy semantics (design-system.md §2).
        tier: {
          green: 'var(--co-tier-green)',
          yellow: 'var(--co-tier-yellow)',
          red: 'var(--co-tier-red)',
        },
        // Confidence bands for calibrated CIE outputs.
        confidence: {
          low: 'var(--co-confidence-low)',
          med: 'var(--co-confidence-med)',
          high: 'var(--co-confidence-high)',
        },
      },
      borderRadius: radius,
      transitionDuration: motion,
    },
  },
  plugins: [],
} satisfies Partial<Config>;

export default uiPreset;