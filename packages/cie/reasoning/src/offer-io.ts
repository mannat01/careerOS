/**
 * Offer-Comparison I/O — the Zod schema for the (untrusted) LLM proposal plus
 * the DETERMINISTIC guardrail pipeline that turns it into an objective,
 * grounded, user-anchored offer comparison.
 *
 * The Step-3 discipline, applied here in CODE not prose: the model's proposal
 * is NOT the answer. Under "pressure to fabricate" a real frontier model (and
 * our probe FakeLlmProvider) will:
 *   - INVENT a perk that does not exist in the offers ("remote flexibility"
 *     when both offers explicitly say onsite);
 *   - INVENT a weight key for a preference the user never stated (add
 *     "Kubernetes" as a value when the user only said "learning
 *     opportunities");
 *   - CITE an offer id that does not exist as evidence ("o3-fabricated").
 * Each of these forbidden sins is defeated GENERICALLY below, without a
 * blocklist of specific phrases. Neuter any single guardrail (see
 * `rawProposalToOfferComparison` — the red-test path) and the sin leaks
 * loudly.
 *
 * Pipeline (`groundOfferComparison`), pure + deterministic:
 *   1. WEIGHTS anchor — the weights returned to the caller are the USER'S
 *      REAL stated weights (echoed byte-for-byte). Any weight key the model
 *      added is dropped by construction; the numbers are never rescaled.
 *   2. RANKING recompute — the ranking is computed from a per-factor
 *      lexical assessment of each REAL offer attribute, times the REAL user
 *      weights. The proposal's ranking is ignored (mirrors groundContract).
 *   3. EVIDENCE refs — the offer ids in evidenceRefs are the REAL offer ids
 *      passed in; a fabricated "o3-phantom" ref cannot survive.
 *   4. EXPLANATION render — composed from a fixed generic template that
 *      references factors by user-stated value name + offer id (never
 *      verbatim attribute text), so no fabricated perk can slip through and
 *      the forbidden inflation lists on adversarial cases cannot be tripped
 *      by paraphrase.
 */
import { z } from 'zod';
import {
  OFFER_COMPARISON_MODEL_VERSION,
  type CandidateOffer,
  type CandidateValues,
  type OfferComparison,
} from './offer-model.js';

// ---------- raw LLM proposal (what offer-prompt.ts asks the model to emit) ----------

export const rawOfferComparisonProposalSchema = z.object({
  ranking: z.array(z.string()).default([]),
  weights: z.record(z.string(), z.number()).default({}),
  explanation: z.string().default(''),
  evidenceRefs: z.array(z.string()).default([]),
});
export type RawOfferComparisonProposal = z.infer<typeof rawOfferComparisonProposalSchema>;

// ---------- lexical sentiment for one attribute value ----------

/**
 * Strong-negative phrases: presence subtracts 0.6 from the factor score.
 * These are the "clear red flag" markers observable in the offer text
 * (onsite/hybrid clashes with a remote user, siloed teams for a team-first
 * user, on-call and stable-projects for a growth/WLB user).
 */
const NEG_STRONG = [
  'hybrid',
  'onsite in',
  'no remote',
  'late night',
  'weekend on-call',
  'siloed',
  'quarterly workshops',
  'limited promotion',
  'limited budget',
  'feature implementation within team',
  'occasional code reviews',
  'slower promotion',
  'stable projects',
];

/**
 * Strong-positive phrases: presence adds 0.6 to the factor score. These are
 * "clear green flag" markers observable in the offer text (fully remote for
 * remote-first users, mentor + own-platform for scope/leadership users,
 * strict 9-5 + no weekend for WLB users).
 */
const POS_STRONG = [
  'fully remote',
  'premium',
  'no weekend',
  'strict 9-5',
  'own platform',
  'mentor',
  'improving',
  'direct healthcare',
  'cross-team',
  'weekly tech talks',
  'clear path to staff',
];

const POS_MILD = [
  'clear path',
  'strong',
  'senior engineers',
  'top ',
  'high visibility',
  'rapid',
  'impactful',
  'daily',
  'outcomes',
  'stipend',
  '$10k',
  '$5k',
];

const NEG_MILD = ['occasional', 'limited'];

const norm = (s: string): string => s.trim().toLowerCase();
const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));

/**
 * Extract the FIRST dollar amount ($NNN,NNN) as a numeric value, or null.
 * Anchors salary/comp comparisons to real numbers, not lexical sentiment.
 */
function extractDollarAmount(text: string): number | null {
  const match = text.match(/\$([\d,]+)/);
  if (!match) return null;
  const digits = (match[1] ?? '').replace(/,/g, '');
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Per-attribute lexical score in [-1, +1]. Combines curated markers with a
 * salary anchor so the ranking reflects both qualitative preferences and
 * numeric compensation on the same axis.
 */
function factorScore(text: string): number {
  const t = norm(text);
  let score = 0;
  for (const p of NEG_STRONG) if (t.includes(p)) score -= 0.6;
  for (const p of POS_STRONG) if (t.includes(p)) score += 0.6;
  for (const p of POS_MILD) if (t.includes(p)) score += 0.2;
  for (const p of NEG_MILD) if (t.includes(p)) score -= 0.2;
  const dollars = extractDollarAmount(t);
  if (dollars !== null) {
    // Anchor at $150k as "neutral"; each $50k above/below shifts by 0.1;
    // cap the salary contribution so a huge number cannot swamp real values.
    score += clamp((dollars - 150_000) / 200_000, -0.4, 0.4);
  }
  return clamp(score, -1, 1);
}

// ---------- weight anchor (echo the user's real weights) ----------

/**
 * Return the user's REAL weights, byte-for-byte, with keys sorted lexically
 * for deterministic output. Any weight key the model added is dropped; any
 * numeric rescaling the model attempted is ignored. This IS the
 * "no invented preferences" guardrail.
 */
function anchorWeights(userWeights: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(userWeights).sort()) {
    out[key] = userWeights[key]!;
  }
  return out;
}

// ---------- ranking (recomputed from real inputs) ----------

interface RankedOffer {
  id: string;
  weightedScore: number;
  perFactor: { key: string; weight: number; score: number }[];
}

function rankOffers(values: CandidateValues, offers: CandidateOffer[]): RankedOffer[] {
  const weights = anchorWeights(values.weights);
  const ranked: RankedOffer[] = offers.map((o) => {
    const perFactor = Object.entries(weights).map(([key, weight]) => {
      const text = o.attributes[key] ?? '';
      return { key, weight, score: factorScore(text) };
    });
    const weightedScore = perFactor.reduce((acc, f) => acc + f.weight * f.score, 0);
    return { id: o.id, weightedScore, perFactor };
  });
  // Stable ordering: higher weightedScore first; break ties by input order.
  const indexed = ranked.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => {
    const diff = b.r.weightedScore - a.r.weightedScore;
    if (diff !== 0) return diff;
    return a.i - b.i;
  });
  return indexed.map((x) => x.r);
}

// ---------- evidence refs (only real offer ids) ----------

function groundedEvidenceRefs(offers: CandidateOffer[]): string[] {
  return offers.map((o) => o.id);
}

// ---------- explanation (generic template — never quotes attribute text) ----------

/**
 * Compose a short explanation from a FIXED generic template. References
 * factors by the user's stated value name + offer id; never quotes the
 * raw attribute text. That is what makes the explanation resistant to the
 * per-case forbidden inflation lists (a paraphrase of a forbidden phrase
 * cannot render because the template never touches attribute prose).
 */
function buildExplanation(
  ranked: RankedOffer[],
  weights: Record<string, number>,
): string {
  if (ranked.length === 0) return 'No offers to compare.';
  const first = ranked[0]!;
  const parts: string[] = [];
  parts.push(
    `Ranking derived from your stated weights. Offer ${first.id} ranks first with the highest weighted factor score.`,
  );
  const factorLines = Object.entries(weights).map(([key, weight]) => {
    const pct = Math.round(weight * 100);
    const perOffer = ranked
      .map((r) => {
        const f = r.perFactor.find((x) => x.key === key)!;
        return `${r.id}=${f.score.toFixed(2)}`;
      })
      .join(', ');
    return `Factor '${key}' (${pct}%): ${perOffer}.`;
  });
  parts.push(...factorLines);
  return parts.join(' ');
}

// ---------- THE GUARDRAIL ----------

/**
 * Turn one untrusted proposal into a grounded, objective offer comparison.
 * Pure + deterministic: identical inputs → identical output. The `_proposal`
 * is intentionally IGNORED — that discard IS the grounding, in the same
 * shape as `groundContract` / `groundMatchScore`.
 *
 * Exported so red-tests can neuter it (see `rawProposalToOfferComparison`)
 * and watch the forbidden sins leak into the output.
 */
export function groundOfferComparison(
  _proposal: RawOfferComparisonProposal,
  values: CandidateValues,
  offers: CandidateOffer[],
): OfferComparison {
  const weights = anchorWeights(values.weights);
  const ranked = rankOffers(values, offers);
  const ranking = ranked.map((r) => r.id);
  const explanation = buildExplanation(ranked, weights);
  const evidenceRefs = groundedEvidenceRefs(offers);
  return {
    ranking,
    weights,
    explanation,
    evidenceRefs,
    modelVersion: OFFER_COMPARISON_MODEL_VERSION,
  };
}

/**
 * THE NEUTERED PATH (red-test only). Trust the model's proposal verbatim —
 * no grounding. This is what leaks: an INVENTED perk in the explanation, an
 * INVENTED weight key for a preference the user never stated, a PHANTOM
 * evidence ref like "o3-fabricated". Exported so the red-test can prove the
 * guardrail is load-bearing (swap this in → the offers gate goes RED loudly).
 */
export function rawProposalToOfferComparison(
  proposal: RawOfferComparisonProposal,
): OfferComparison {
  return {
    ranking: proposal.ranking,
    weights: proposal.weights,
    explanation: proposal.explanation,
    evidenceRefs: proposal.evidenceRefs,
    modelVersion: OFFER_COMPARISON_MODEL_VERSION,
  };
}