import type { Config } from 'tailwindcss';
import { uiPreset } from '@careeros/ui/tailwind-preset';

/**
 * apps/web Tailwind config — thin wrapper over the shared `@careeros/ui`
 * preset. The preset owns theme names (colors/motion/radius) so tokens stay
 * drift-free across future apps. If you need an app-specific extension, add
 * it here — do NOT redefine tokens (design-system.md §2).
 */
const config: Config = {
  presets: [uiPreset as unknown as Config],
  content: [
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    // Pull in the UI package so JIT sees classes composed there.
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
};

export default config;