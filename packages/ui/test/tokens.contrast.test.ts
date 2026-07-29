import { describe, expect, it } from 'vitest';
import { tokens, type Theme, type TokenKey } from '../src/tokens.js';

/**
 * Contrast smoke test — proves the tier + confidence tokens (and the core
 * text tokens) meet WCAG AA in BOTH themes. Load-bearing: if we ship a
 * tier/confidence hex that fails contrast, colorblind and low-vision users
 * silently lose the autonomy-boundary signal — that is the exact failure
 * mode this test exists to prevent.
 *
 * Reference: WCAG 2.1 §1.4.3 (text ≥4.5:1, large text/UI ≥3:1).
 */

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`Not a 6-digit hex: ${hex}`);
  const rawHex = m[1];
  if (rawHex === undefined) throw new Error(`Not a 6-digit hex: ${hex}`);
  const n = parseInt(rawHex, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function relLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const chan = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrastRatio(a: string, b: string): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Text-on-bg tokens must clear 4.5:1 (AA body-text).
const TEXT_PAIRS: Array<{ fg: TokenKey; bg: TokenKey; min: number }> = [
  { fg: 'text.primary', bg: 'bg.base', min: 4.5 },
  { fg: 'text.secondary', bg: 'bg.base', min: 4.5 },
  { fg: 'text.muted', bg: 'bg.base', min: 4.5 },
];

// Tier + confidence are UI+text carriers ("Yellow — approval needed") and MUST
// clear AA for body text so the label itself is legible when set in the token
// color. This is what stops tier from being color-only.
const SEMANTIC_PAIRS: Array<{ fg: TokenKey; bg: TokenKey; min: number }> = [
  { fg: 'tier.green', bg: 'bg.base', min: 4.5 },
  { fg: 'tier.yellow', bg: 'bg.base', min: 4.5 },
  { fg: 'tier.red', bg: 'bg.base', min: 4.5 },
  { fg: 'confidence.low', bg: 'bg.base', min: 4.5 },
  { fg: 'confidence.med', bg: 'bg.base', min: 4.5 },
  { fg: 'confidence.high', bg: 'bg.base', min: 4.5 },
];

// UI (non-text) contrast target — 3:1 per WCAG 2.1 §1.4.11. Only tokens
// that carry INTERACTION state qualify; decorative dividers (border.subtle,
// border.strong) are exempt. Focus ring is the load-bearing one — losing it
// silently strands keyboard users.
const UI_PAIRS: Array<{ fg: TokenKey; bg: TokenKey; min: number }> = [
  { fg: 'focus.ring', bg: 'bg.base', min: 3 },
];

describe.each<Theme>(['light', 'dark'])('token contrast — %s theme', (theme) => {
  const t = tokens[theme];

  it.each(TEXT_PAIRS)('text $fg on $bg ≥ AA', ({ fg, bg, min }) => {
    const ratio = contrastRatio(t[fg], t[bg]);
    expect(ratio, `${theme} ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });

  it.each(SEMANTIC_PAIRS)('tier/confidence $fg on $bg ≥ AA text', ({ fg, bg, min }) => {
    const ratio = contrastRatio(t[fg], t[bg]);
    expect(ratio, `${theme} ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });

  it.each(UI_PAIRS)('UI $fg on $bg ≥ AA non-text', ({ fg, bg, min }) => {
    const ratio = contrastRatio(t[fg], t[bg]);
    expect(ratio, `${theme} ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });
});