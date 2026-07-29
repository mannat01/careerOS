/**
 * @careeros/ui — design-system entry.
 *
 * FM1 scope: tokens (source of truth) + Tailwind preset only. Trust Kit
 * components (`<AiSurface>`, `<TierBadge>`, etc.) land in FM1 Task 5
 * (Batch C) — see docs/frontend-milestone-01-workorder.md §5.
 */
export {
  tokens,
  cssVar,
  motion,
  radius,
  spacingBasePx,
  type TokenKey,
  type Theme,
} from './tokens.js';
export { uiPreset } from './tailwind-preset.js';