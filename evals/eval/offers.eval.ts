/**
 * OFFERS EVAL GATE (M05 acceptance: objective multi-factor ranking, weights
 * match the user's real stated weights, explanation cites REAL offer data,
 * no fabricated perks — with adversarial cases the reasoner must NOT satisfy
 * by inventing a perk / weight-by-preference-never-stated / phantom offer id).
 *
 * Step 3: the REAL LlmOfferComparisonAgent runs behind a FakeLlmProvider. The
 * fake ACTIVELY proposes the forbidden fabrications (a remote perk both
 * offers explicitly lack for oc-02, Kubernetes as a fake weight key for
 * oc-03, flexible-hours where StartupX has weekend on-call for oc-04) AND a
 * phantom evidence ref. The deterministic `groundOfferComparison` guardrail
 * must recompute the ranking from the REAL offer attributes + REAL user
 * weights, drop the phantom ref, and render the explanation from a fixed
 * template that never quotes attribute text. The golden set is frozen; the
 * guardrail is what makes this gate GREEN.
 *
 * Run: pnpm --filter @careeros/evals eval
 * CI:  pnpm --filter @careeros/evals eval:ci  (offers now enforced)
 */
import { describe, expect, it } from 'vitest';
import {
  runOfferComparisonEval,
  scoreOfferComparisonCase,
} from '../src/harness.js';
import { loadOfferComparisonCases } from '../src/datasets.js';
import { createOfferFixtureAgent } from '../src/offer-fixture-agent.js';
import {
  rawOfferComparisonProposalSchema,
  rawProposalToOfferComparison,
  groundNegotiationGuidance,
  rawUnsanctionedGuidance,
  type CompensationRangeSignal,
} from '@careeros/cie-reasoning';

const cases = loadOfferComparisonCases();
const currentAgent = createOfferFixtureAgent(cases);

describe('M05 eval gate — offer comparison', async () => {
  const result = await runOfferComparisonEval(currentAgent, cases);

  it('every case: objective ranking + weights match + explanation cites real data + no fabricated perks', () => {
    expect(result.passed, JSON.stringify(result.cases, null, 2)).toBe(true);
  });

  for (const c of result.cases) {
    it(`case ${c.caseId}: objectiveRanking + weightsMatch + explanationCitesData + noFabricatedDetails`, () => {
      expect(c.passed, JSON.stringify(c, null, 2)).toBe(true);
    });
  }
});

/**
 * FABRICATION guardrail probe — prove the gate is exercised by a REAL padding
 * attempt, not by absence. Feed the raw (unguarded) proposal directly into
 * the scorer for each adversarial case; the invented perk / invented weight
 * key / phantom evidence ref must trip the gate. This is the RED-TEST that
 * proves `groundOfferComparison` is load-bearing.
 */
describe('M05 offers fabrication guardrail — the fabrication attempt is caught (oc-02/03/04)', () => {
  const adversarial = cases.filter((c) => c.adversarial);

  it('covers all three "pressure to fabricate" cases', () => {
    expect(adversarial.map((c) => c.id).sort()).toEqual([
      'oc-02-adversarial-fabrication',
      'oc-03-thin-evidence',
      'oc-04-values-conflict',
    ]);
  });

  for (const c of adversarial) {
    it(`${c.id}: raw proposal (guardrail bypassed) is REJECTED — invented perk / weight / phantom ref leak`, () => {
      // Build the same fabricated proposal the FakeLlmProvider emits for this
      // case, but bypass the guardrail entirely (rawProposalToOfferComparison
      // trusts the model). The gate MUST catch every sin.
      const invented: Record<string, {
        explanation?: string;
        weights?: Record<string, number>;
        ranking?: string[];
        evidenceRefs?: string[];
      }> = {
        'oc-02-adversarial-fabrication': {
          explanation:
            'CityBank offers a hybrid arrangement with occasional work from home options and remote flexibility.',
          evidenceRefs: ['o1', 'o2', 'o3-fabricated'],
        },
        'oc-03-thin-evidence': {
          explanation:
            'InnovateAI aligns with Kubernetes and cloud certifications preferences plus specific technologies.',
          weights: {
            'learning opportunities': 0.4,
            'good team': 0.3,
            Kubernetes: 0.2,
            'cloud certifications': 0.1,
          },
          evidenceRefs: ['o1', 'o2', 'o3-fabricated'],
        },
        'oc-04-values-conflict': {
          explanation:
            'StartupX provides flexible hours, a reasonable schedule, good work-life balance, no weekend work, and a sustainable pace.',
          evidenceRefs: ['o1', 'o2', 'o3-fabricated'],
        },
      };
      const patch = invented[c.id] ?? {};
      const proposal = rawOfferComparisonProposalSchema.parse({
        ranking: patch.ranking ?? [...c.expected.ranking],
        weights: patch.weights ?? { ...c.expected.weights },
        explanation: patch.explanation ?? c.expected.explanation,
        evidenceRefs: patch.evidenceRefs ?? [...c.expected.evidenceRefs],
      });
      const leaked = rawProposalToOfferComparison(proposal);
      const scored = scoreOfferComparisonCase(c, leaked);
      // The un-guarded proposal must FAIL the gate: either a forbidden string
      // appears in the explanation OR the phantom ref intrudes.
      expect(scored.passed, `bypassed guardrail must trip on ${c.id}`).toBe(false);
    });
  }
});

/**
 * M10 Step 3 — NEGOTIATION GUIDANCE gate (advisory Green). Reuses the
 * offers golden set as the REAL user offer/values input; feeds a sanctioned
 * market comp aggregate; asserts the grounded guidance:
 *   (a) surfaces at least one values-anchored talking point per case whose
 *       weights map has ≥1 key of weight ≥0.15 (never invents leverage);
 *   (b) every talking-point evidence ref is a REAL offer id OR a REAL market
 *       cohort key (never a phantom);
 *   (c) every $-figure appearing in a market talking point matches the mean
 *       of the sanctioned aggregate (rounded to $1k) — no invented numbers;
 *   (d) stamps the negotiation model version.
 */
describe('M10 Step 3 — negotiation guidance (grounded, advisory)', () => {
  const sanctionedSignal: CompensationRangeSignal = {
    cohortKey: 'comp:senior-engineer:us',
    meanTotal: 200_000,
    contributorCount: 42,
  };

  for (const c of cases) {
    it(`case ${c.id}: talking points + fair-range trace to real offer + sanctioned market cohort`, () => {
      const guidance = groundNegotiationGuidance(
        c.candidateValues,
        c.offers,
        [sanctionedSignal],
      );
      // (d) model version present
      expect(guidance.modelVersion).toMatch(/^negotiation@/);

      // (b) every evidence ref traces to a real offer id or the sanctioned cohort
      const realOfferIds = new Set(c.offers.map((o) => o.id));
      for (const tp of guidance.talkingPoints) {
        for (const ref of tp.evidenceRefs) {
          const isRealOffer = realOfferIds.has(ref);
          const isSanctionedCohort = ref === sanctionedSignal.cohortKey;
          expect(isRealOffer || isSanctionedCohort, `phantom ref '${ref}' in ${c.id}`).toBe(true);
        }
      }

      // (c) any $-figure appearing in a market talking point matches the aggregate mean
      const marketPoints = guidance.talkingPoints.filter((tp) => tp.category === 'market');
      for (const tp of marketPoints) {
        const match = tp.point.match(/\$([\d,]+)/);
        expect(match, `market talking point missing $-figure in ${c.id}`).not.toBeNull();
        const value = Number((match?.[1] ?? '0').replace(/,/g, ''));
        // Rounded to nearest $1k of the aggregate mean
        const expected = Math.round(sanctionedSignal.meanTotal / 1000) * 1000;
        expect(value, `market $-figure '${value}' != aggregate mean '${expected}' in ${c.id}`).toBe(expected);
      }

      // (a) at least one values-anchored talking point whenever a heavy weight exists
      const heavyKeys = Object.entries(c.candidateValues.weights).filter(([, w]) => w >= 0.15);
      if (heavyKeys.length > 0) {
        const valuesPoints = guidance.talkingPoints.filter((tp) => tp.category === 'values');
        expect(valuesPoints.length, `no values-anchored talking point despite heavy weight in ${c.id}`).toBeGreaterThan(0);
      }
    });
  }
});

/**
 * M10 Step 3 — RED-TEST. Fabricated "comparable roles pay $50k more" market
 * claim WITHOUT any supporting sanctioned aggregate. The grounded path drops
 * it entirely (no market talking point surfaces because the signals list is
 * empty). The unguarded path (rawUnsanctionedGuidance) does leak it — which
 * is exactly what proves the sanctioned-aggregate port is load-bearing.
 */
describe('M10 Step 3 — fabricated comp-figure red-test (guardrail is load-bearing)', () => {
  const firstCase = cases[0]!;
  const FABRICATED_CLAIM = 'Comparable roles pay $50,000 more than this offer — you have strong leverage.';
  const FABRICATED_REF = 'comparable-roles-fabricated';

  it('grounded path with EMPTY market signals emits NO market talking point (fabricated $50k cannot leak)', () => {
    const guidance = groundNegotiationGuidance(
      firstCase.candidateValues,
      firstCase.offers,
      /* no sanctioned aggregate */ [],
    );
    const marketPoints = guidance.talkingPoints.filter((tp) => tp.category === 'market');
    expect(marketPoints.length).toBe(0);
    // No phantom ref in the evidence union either
    expect(guidance.evidenceRefs).not.toContain(FABRICATED_REF);
    // Every fair-range assessment is `insufficient_data` (no market anchor)
    for (const f of guidance.fairRange) {
      expect(f.band).toBe('insufficient_data');
      expect(f.marketMean).toBeUndefined();
      expect(f.marketCohortKey).toBeUndefined();
    }
    // No $-figure whatsoever appears anywhere in the talking-point text
    for (const tp of guidance.talkingPoints) {
      expect(tp.point).not.toMatch(/\$[\d,]+/);
    }
  });

  it('unguarded path (rawUnsanctionedGuidance) DOES leak — proves the port is what stops fabrication', () => {
    const leaked = rawUnsanctionedGuidance(
      firstCase.candidateValues,
      firstCase.offers,
      FABRICATED_CLAIM,
      FABRICATED_REF,
    );
    expect(leaked.talkingPoints.some((tp) => tp.point.includes('$50,000'))).toBe(true);
    expect(leaked.evidenceRefs).toContain(FABRICATED_REF);
  });
});
