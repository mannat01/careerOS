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