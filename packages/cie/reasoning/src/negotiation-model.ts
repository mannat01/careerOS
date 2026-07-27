/**
 * M10 Step 3 — Negotiation & Offer Intelligence (advisory).
 *
 * DOMAIN MODEL for grounded negotiation guidance derived from:
 *   - the caller's REAL candidate offers (real attribute fields),
 *   - the caller's REAL stated values/weights,
 *   - sanctioned MARKET COMP SIGNALS (de-identified, k-anonymized aggregates
 *     produced by @careeros/cie-market-intel — never raw per-user data).
 *
 * ZERO-FABRICATION INVARIANTS (each a golden/red test):
 *   - Every talking point traces to a REAL offer field OR a REAL market
 *     aggregate — no invented comp numbers, no fabricated leverage.
 *   - Weights on the guidance reflect the user's real stated weights (never
 *     rescaled or padded with a key the user didn't state).
 *   - Every `evidenceRef` is either a REAL offer id or a REAL market cohort
 *     key returned by the sanctioned aggregate port.
 *
 * The output is ADVISORY (Green). accept/dec‍line of an offer stays RED — it
 * has no callable execution path anywhere in the system; a request to
 * auto-accept is refused with `red_never_automated` at the endpoint boundary.
 */

export const NEGOTIATION_MODEL_VERSION = 'negotiation@1.0.0';

/**
 * A sanctioned MARKET comp signal, sourced ONLY from the market-intel
 * aggregate store (or an equivalent research aggregate). Carries the
 * de-identified cohort key + a mean total-comp value + the contributor count
 * that already passed the k-anonymity threshold upstream. There is NO
 * per-user field — a leak here is structurally impossible.
 */
export interface CompensationRangeSignal {
  /** De-identified cohort key, e.g. `comp:senior-frontend:us`. */
  readonly cohortKey: string;
  /** Mean total-comp for the cohort (currency-neutral units — dollars here). */
  readonly meanTotal: number;
  /** Distinct-contributor count ≥ the k-anon threshold enforced upstream. */
  readonly contributorCount: number;
}

/**
 * One category of grounded talking point. `base`/`equity`/`signing`/`perks`
 * only render if the offer HAS a matching real attribute; `market` only
 * renders if a sanctioned market signal is present.
 */
export type NegotiationTalkingPointCategory =
  | 'base'
  | 'equity'
  | 'signing'
  | 'perks'
  | 'growth'
  | 'market'
  | 'values';

/**
 * One grounded talking point. Every field is derived from real inputs; the
 * `evidenceRefs` list MUST include either a real offer id OR a real market
 * cohort key (never a phantom).
 */
export interface NegotiationTalkingPoint {
  readonly category: NegotiationTalkingPointCategory;
  readonly point: string;
  readonly evidenceRefs: readonly string[];
}

/**
 * Per-offer fair-range assessment. `band` is `insufficient_data` when either
 * the offer has no extractable total-comp number OR no sanctioned market
 * signal is available — NEVER a made-up band based on nothing.
 */
export type FairRangeBand = 'below' | 'within' | 'above' | 'insufficient_data';

export interface FairRangeAssessment {
  readonly offerId: string;
  /** Extracted total-comp from the offer, or null if not detectable. */
  readonly offerTotal: number | null;
  readonly band: FairRangeBand;
  /** Populated ONLY when band ≠ 'insufficient_data'. */
  readonly marketMean?: number;
  readonly marketCohortKey?: string;
  readonly marketContributorCount?: number;
  /** Fair-band bounds (±15% around marketMean) — echoed for transparency. */
  readonly fairLow?: number;
  readonly fairHigh?: number;
}

/**
 * The grounded negotiation guidance response. Advisory only.
 * `evidenceRefs` is the union of every real offer id + real market cohort
 * key any talking point / fair-range used.
 */
export interface NegotiationGuidance {
  readonly talkingPoints: readonly NegotiationTalkingPoint[];
  readonly fairRange: readonly FairRangeAssessment[];
  readonly reasons: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly modelVersion: string;
}

/**
 * Narrow port — the ONLY way the negotiation service reaches market comp
 * signals. Bootstrap wires this to an adapter over the sanctioned market-intel
 * aggregate store; the negotiation package NEVER imports @careeros/db and
 * never reads a raw per-user row.
 */
export interface MarketCompRangePort {
  /** Return sanctioned comp-range signals (de-identified aggregates only). */
  getRanges(): Promise<CompensationRangeSignal[]>;
}