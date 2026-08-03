/**
 * Shared Trust Kit types — the *contract* every AI-produced surface obeys.
 *
 * These types are the ground truth: `Evidence`, `Confidence`, and `Tier`
 * are load-bearing structural requirements enforced by `<AiSurface>` at
 * compile time. Any change here ripples to every consumer, which is the
 * whole point — the UI cannot silently weaken a backend guarantee.
 *
 * Kept in a tiny standalone file (no React imports) so type-only tests can
 * pull them without dragging in the DOM runtime.
 */

/**
 * Autonomy tier — mirrors `packages/capability-gate/src/tiers.ts`.
 * `docs/frontend-architecture.md §5` names these as the load-bearing
 * autonomy semantics; they MUST render with icon + label + color (a11y).
 */
export type Tier = 'green' | 'yellow' | 'red';

/** Discrete confidence bands. UI never invents a value from a raw number —
 *  the backend supplies a band alongside the value so calibration stays honest. */
export type ConfidenceBand = 'low' | 'med' | 'high';

/**
 * A single piece of evidence backing an AI output. `id` is the resolvable
 * pointer used by the drill-down endpoints (e.g. `/v1/evidence/:id`);
 * `source` names WHERE it came from ("resume", "job-posting", "bls-oes");
 * `snippet` is a short human-readable excerpt (≤240 chars, sanitized).
 * `url` is optional — only external sources have one.
 */
export interface Evidence {
  readonly id: string;
  readonly source: string;
  readonly snippet: string;
  readonly url?: string;
}

/**
 * Calibrated confidence. `value` is 0..1 (inclusive) but the UI renders the
 * `band` FIRST — a single number is misleading without the band.
 *
 * `source` names the calibrator that produced this ("bayes-v2",
 * "isotonic-2026-03"), which links to the calibration page.
 */
export interface Confidence {
  readonly value: number;
  readonly band: ConfidenceBand;
  readonly source: string;
}

/** Provenance of a user profile fact — never omitted, never guessed. */
export type Provenance = 'imported' | 'user' | 'inferred_confirmed' | 'from_notes';

/**
 * Subject of a "why" — the thing being explained. Kept small so it's
 * cheap to pass around; the popover shows this plus evidence + reasoning.
 */
export interface Subject {
  readonly kind: string; // "score" | "insight" | "recommendation" | "metric" | …
  readonly label: string; // human-facing subject label
}

/** Runtime helper: derive a confidence band from a numeric value. Used only
 *  when constructing test fixtures — production values come from the API. */
export function bandFor(value: number): ConfidenceBand {
  if (value < 0.5) return 'low';
  if (value < 0.8) return 'med';
  return 'high';
}