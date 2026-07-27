/**
 * M10 Step 3 — Negotiation guidance guardrail. Pure + deterministic.
 *
 * DISCARD-AND-RECOMPUTE discipline (same shape as `groundOfferComparison`):
 * any untrusted LLM proposal is ignored. Every emitted talking point
 * category, every fair-range figure, and every evidence ref MUST trace to a
 * real input:
 *   - a REAL attribute field on one of the caller's offers, OR
 *   - a REAL sanctioned market aggregate (from the market-intel port), OR
 *   - a REAL user-stated value/weight.
 *
 * FABRICATION SINS DEFEATED HERE (each provable by a red-test):
 *   1. INVENTED COMP FIGURE ("comparable roles pay $50k more" with no
 *      supporting aggregate) — impossible because a `market` talking point
 *      only renders when `CompensationRangeSignal`s are present; the
 *      numbers used come STRAIGHT from those aggregates' `meanTotal`. Feed
 *      an empty market list → zero market talking points, zero fabricated
 *      figure can leak. Feed a raw proposal path (unguarded) with a
 *      "$50k more" claim → the fair-range assessment stays
 *      `insufficient_data` for that offer AND the market talking points are
 *      dropped, so the response has NO $-figure the caller can act on.
 *   2. INVENTED LEVERAGE (weight key the user never stated) — impossible
 *      because `values` talking points iterate the USER'S weights map only.
 *   3. PHANTOM EVIDENCE REF ("comparable-role-fabricated") — impossible
 *      because `evidenceRefs` is composed strictly from real offer ids +
 *      real market cohort keys the guardrail actually consumed.
 */
import {
  NEGOTIATION_MODEL_VERSION,
  type CompensationRangeSignal,
  type FairRangeAssessment,
  type FairRangeBand,
  type NegotiationGuidance,
  type NegotiationTalkingPoint,
} from './negotiation-model.js';
import type {
  CandidateOffer,
  CandidateValues,
} from './offer-model.js';

/** Fair-band tolerance around the market mean (±15%). */
const FAIR_BAND_TOLERANCE = 0.15;

/**
 * Extract the FIRST dollar amount ($NNN,NNN or $NNN,NNNk) from an attribute
 * value. Returns null if no numeric anchor is present — the caller then
 * marks the fair-range as `insufficient_data` rather than inventing one.
 */
function extractDollarAmount(text: string): number | null {
  const match = text.match(/\$([\d,]+)(k?)/i);
  if (!match) return null;
  const digits = (match[1] ?? '').replace(/,/g, '');
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return null;
  return match[2]?.toLowerCase() === 'k' ? n * 1000 : n;
}

/**
 * Extract the offer's total-comp anchor from its real attributes. Looks at a
 * short, fixed list of attribute keys that carry compensation and returns
 * the first $-figure found. This is the ONLY code path from an offer to a
 * numeric total — no free-text $-claim can slip in elsewhere.
 */
function extractOfferTotal(offer: CandidateOffer): number | null {
  const candidateKeys = [
    'total_comp',
    'total compensation',
    'base',
    'base_salary',
    'base salary',
    'compensation',
    'salary',
    'comp',
  ];
  for (const key of candidateKeys) {
    const value = offer.attributes[key];
    if (typeof value === 'string' && value.length > 0) {
      const n = extractDollarAmount(value);
      if (n !== null) return n;
    }
  }
  // Fall back: scan all attribute values for a $-figure. Still real — the
  // number comes from a real attribute the user provided.
  for (const value of Object.values(offer.attributes)) {
    if (typeof value === 'string') {
      const n = extractDollarAmount(value);
      if (n !== null) return n;
    }
  }
  return null;
}

/**
 * Compute the fair-range band for one offer against the (optional) sanctioned
 * market mean. `insufficient_data` when either input is missing.
 */
function computeBand(
  offerTotal: number | null,
  marketMean: number | undefined,
): FairRangeBand {
  if (offerTotal === null || marketMean === undefined) return 'insufficient_data';
  const low = marketMean * (1 - FAIR_BAND_TOLERANCE);
  const high = marketMean * (1 + FAIR_BAND_TOLERANCE);
  if (offerTotal < low) return 'below';
  if (offerTotal > high) return 'above';
  return 'within';
}

/**
 * Pick the "best" sanctioned market signal for an offer — the aggregate with
 * the LARGEST contributor count wins (most robust cohort). We deliberately
 * do NOT try to fuzzy-match cohort keys to offer titles: the caller wires
 * an adapter that pre-filters to relevant cohorts, and if the adapter
 * returned an empty list the fair-range stays `insufficient_data`.
 */
function pickBestSignal(
  signals: readonly CompensationRangeSignal[],
): CompensationRangeSignal | undefined {
  if (signals.length === 0) return undefined;
  let best = signals[0]!;
  for (const s of signals) {
    if (s.contributorCount > best.contributorCount) best = s;
  }
  return best;
}

/**
 * Assess fair-range per offer. Every field is derived from real inputs; when
 * inputs are missing, band is `insufficient_data` and no market fields are
 * populated (structural refusal to invent a range).
 */
function assessFairRange(
  offers: readonly CandidateOffer[],
  signals: readonly CompensationRangeSignal[],
): FairRangeAssessment[] {
  const best = pickBestSignal(signals);
  return offers.map((offer) => {
    const offerTotal = extractOfferTotal(offer);
    const band = computeBand(offerTotal, best?.meanTotal);
    if (band === 'insufficient_data' || !best) {
      return { offerId: offer.id, offerTotal, band };
    }
    return {
      offerId: offer.id,
      offerTotal,
      band,
      marketMean: best.meanTotal,
      marketCohortKey: best.cohortKey,
      marketContributorCount: best.contributorCount,
      fairLow: Math.round(best.meanTotal * (1 - FAIR_BAND_TOLERANCE)),
      fairHigh: Math.round(best.meanTotal * (1 + FAIR_BAND_TOLERANCE)),
    };
  });
}

/**
 * Build the (deterministic) talking-points list. Each point is composed from
 * a FIXED template + real inputs; no attribute prose is ever quoted verbatim
 * so a paraphrased "hybrid perk" can't slip in. Categories only render when
 * the underlying real input is present.
 */
function buildTalkingPoints(
  values: CandidateValues,
  offers: readonly CandidateOffer[],
  signals: readonly CompensationRangeSignal[],
  fair: readonly FairRangeAssessment[],
): NegotiationTalkingPoint[] {
  const out: NegotiationTalkingPoint[] = [];

  // 1. Values-anchored leverage — iterates the USER'S weights only (never a
  //    key the LLM proposed). Weights above 0.15 are surfaced as leverage.
  const weightedKeys = Object.entries(values.weights)
    .filter(([, w]) => w >= 0.15)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
  for (const key of weightedKeys) {
    // Only cite the leverage when at least one offer has a real attribute
    // for this value key — otherwise it's just an unanchored preference.
    const relevantOfferIds = offers
      .filter((o) => typeof o.attributes[key] === 'string' && o.attributes[key].length > 0)
      .map((o) => o.id);
    if (relevantOfferIds.length === 0) continue;
    const pct = Math.round((values.weights[key] ?? 0) * 100);
    out.push({
      category: 'values',
      point: `You stated '${key}' as a top priority (weight ${pct}%). Anchor your ask on how each offer supports it.`,
      evidenceRefs: relevantOfferIds,
    });
  }

  // 2. Market talking points — ONLY when sanctioned aggregates are present.
  //    Every $-figure is copied straight from the aggregate's `meanTotal`.
  for (const signal of signals) {
    const rounded = Math.round(signal.meanTotal / 1000) * 1000;
    out.push({
      category: 'market',
      point: `Market comp aggregate for cohort '${signal.cohortKey}' means ~$${rounded.toLocaleString()} (n=${signal.contributorCount}).`,
      evidenceRefs: [signal.cohortKey],
    });
  }

  // 3. Per-offer fair-range framing — only when the band is decisive.
  for (const f of fair) {
    if (f.band === 'insufficient_data' || f.marketCohortKey === undefined) continue;
    if (f.band === 'below') {
      out.push({
        category: 'base',
        point: `Offer ${f.offerId} sits BELOW the fair band ($${(f.fairLow ?? 0).toLocaleString()}–$${(f.fairHigh ?? 0).toLocaleString()}); a base-comp counter is well supported.`,
        evidenceRefs: [f.offerId, f.marketCohortKey],
      });
    } else if (f.band === 'above') {
      out.push({
        category: 'base',
        point: `Offer ${f.offerId} sits ABOVE the fair band; focus the ask on non-comp levers (equity vest, signing, growth).`,
        evidenceRefs: [f.offerId, f.marketCohortKey],
      });
    } else {
      out.push({
        category: 'base',
        point: `Offer ${f.offerId} sits WITHIN the fair band; small comp counters are plausible, larger asks need a differentiator.`,
        evidenceRefs: [f.offerId, f.marketCohortKey],
      });
    }
  }

  // 4. Structural offer categories (equity/signing/growth/perks) — one point
  //    per offer that has a real attribute in that category. NEVER invents
  //    an attribute the offer doesn't carry.
  const structuralKeys: ReadonlyArray<{
    category: NegotiationTalkingPoint['category'];
    match: readonly string[];
    line: (offerId: string) => string;
  }> = [
    {
      category: 'equity',
      match: ['equity', 'rsu', 'stock', 'options'],
      line: (id) => `Offer ${id} lists equity — a refresh grant or accelerated vest is a common ask.`,
    },
    {
      category: 'signing',
      match: ['signing', 'sign-on', 'bonus'],
      line: (id) => `Offer ${id} lists a signing/bonus component — signing bonuses are the easiest lever to move.`,
    },
    {
      category: 'growth',
      match: ['growth', 'promotion', 'mentor', 'career'],
      line: (id) => `Offer ${id} references growth/promotion — anchor a review cadence or mentorship commitment.`,
    },
    {
      category: 'perks',
      match: ['remote', 'wfh', 'flex', 'pto', 'vacation', 'stipend', 'wellness'],
      line: (id) => `Offer ${id} lists a real perk you value — codify it in writing (start date, budget cap, cadence).`,
    },
  ];
  for (const struct of structuralKeys) {
    for (const offer of offers) {
      const hasReal = Object.entries(offer.attributes).some(([k, v]) =>
        typeof v === 'string' &&
        v.length > 0 &&
        struct.match.some((m) => k.toLowerCase().includes(m) || v.toLowerCase().includes(m)),
      );
      if (!hasReal) continue;
      out.push({
        category: struct.category,
        point: struct.line(offer.id),
        evidenceRefs: [offer.id],
      });
    }
  }

  return out;
}

/**
 * Compose short, honest reason lines explaining what grounded the guidance
 * (or what was missing). Never manufactures leverage from thin air.
 */
function buildReasons(
  values: CandidateValues,
  offers: readonly CandidateOffer[],
  signals: readonly CompensationRangeSignal[],
  fair: readonly FairRangeAssessment[],
): string[] {
  const reasons: string[] = [];
  reasons.push(`Weights echoed from user's real stated preferences (${Object.keys(values.weights).length} keys).`);
  reasons.push(`Compared ${offers.length} real offer(s) against ${signals.length} sanctioned market aggregate(s).`);
  const decisive = fair.filter((f) => f.band !== 'insufficient_data').length;
  if (decisive === 0) {
    reasons.push('No decisive fair-range assessment (either offer comp not extractable or no sanctioned market signal).');
  } else {
    reasons.push(`${decisive} of ${fair.length} offer(s) had a decisive fair-range band.`);
  }
  return reasons;
}

/**
 * THE GUARDRAIL. Pure + deterministic — identical inputs → identical output.
 * Advisory only; the caller must NEVER interpret this as an accept/dec‍line
 * directive (that stays Red at the endpoint boundary — no callable path).
 */
export function groundNegotiationGuidance(
  values: CandidateValues,
  offers: readonly CandidateOffer[],
  signals: readonly CompensationRangeSignal[],
): NegotiationGuidance {
  const fair = assessFairRange(offers, signals);
  const talkingPoints = buildTalkingPoints(values, offers, signals, fair);
  const reasons = buildReasons(values, offers, signals, fair);

  // evidenceRefs = union of every real ref any talking point / fair-range used.
  const refs = new Set<string>();
  for (const tp of talkingPoints) for (const r of tp.evidenceRefs) refs.add(r);
  for (const f of fair) {
    if (f.marketCohortKey) refs.add(f.marketCohortKey);
    refs.add(f.offerId);
  }

  return {
    talkingPoints,
    fairRange: fair,
    reasons,
    evidenceRefs: Array.from(refs).sort(),
    modelVersion: NEGOTIATION_MODEL_VERSION,
  };
}

/**
 * THE NEUTERED PATH (red-test only). Trust an untrusted "market claim"
 * verbatim WITHOUT going through the sanctioned aggregate port — i.e. inject
 * a fabricated market signal as if it were sanctioned. This is what leaks:
 * a $-figure with no upstream aggregate. Exported so the red-test can prove
 * the guardrail (specifically the `signals` port being the ONLY source of
 * market numbers) is load-bearing.
 */
export function rawUnsanctionedGuidance(
  values: CandidateValues,
  offers: readonly CandidateOffer[],
  fabricatedClaim: string,
  fabricatedRef: string,
): NegotiationGuidance {
  const fair = assessFairRange(offers, []);
  const talkingPoints: NegotiationTalkingPoint[] = [
    {
      category: 'market',
      point: fabricatedClaim,
      evidenceRefs: [fabricatedRef],
    },
  ];
  return {
    talkingPoints,
    fairRange: fair,
    reasons: ['UNGUARDED path — fabricated market claim was NOT filtered.'],
    evidenceRefs: [fabricatedRef],
    modelVersion: NEGOTIATION_MODEL_VERSION,
  };
  // Note: `values` is intentionally unused here — the point of the red path
  // is to show that WITHOUT the guardrail even the user's real weights are
  // bypassed in favor of the raw claim.
  void values;
}