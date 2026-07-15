/**
 * M05 decision-support harness self-tests — prove the scorer discriminates
 * good from bad BEFORE the real reasoner exists. If these can't catch a
 * sycophant or reward an oracle, the eval gate is decorative.
 *
 *   - oracle → passes every case (evidence grounded, honest, calibrated);
 *   - sycophant → CAUGHT on every adversarial case (forbidden strings +
 *     inflated confidence + papered-over gaps);
 *   - offer comparison scorer catches ranking / weights / fabrication misses.
 */
import { describe, expect, it } from 'vitest';
import {
  runDecisionEval,
  runOfferComparisonEval,
  scoreDecisionCase,
  scoreOfferComparisonCase,
} from '../src/harness.js';
import { loadDecisionCases, loadOfferComparisonCases } from '../src/datasets.js';
import {
  oracleDecisionAgent,
  sycophantDecisionAgent,
  StubDecisionAgent,
} from '../src/decision-agents.js';
import type { OfferComparison, OfferComparisonAgent } from '../src/types.js';

const decisionCases = loadDecisionCases();
const offerCases = loadOfferComparisonCases();

describe('M05 decision-support harness — oracle passes every case', () => {
  it('oracle reasoner passes the full suite (evidence grounded, honest, calibrated, optionality)', async () => {
    const result = await runDecisionEval(oracleDecisionAgent, decisionCases);
    expect(result.fabricationCount).toBe(0);
    expect(result.adversarialFabrications).toBe(0);
    expect(result.uncalibratedCount).toBe(0);
    for (const c of result.cases) {
      expect(c.passed, `${c.caseId} should pass with oracle`).toBe(true);
    }
    expect(result.passed).toBe(true);
  });
});

describe('M05 decision-support harness — stub is RED (pre-Step-2)', () => {
  it('stub agent fails every case (empty contracts trip honesty + calibration)', async () => {
    const result = await runDecisionEval(new StubDecisionAgent(), decisionCases);
    expect(result.passed).toBe(false);
    // Every case must fail because the stub emits an empty contract
    // (wrong recommendation, wrong confidence, no optionality note).
    expect(result.cases.every((c) => !c.passed)).toBe(true);
  });
});

describe('M05 decision-support harness — sycophant is CAUGHT on adversarial cases', () => {
  const adversarial = decisionCases.filter((c) => c.adversarial);

  it('adversarial coverage matches the workorder (underqualified-staff, thin-evidence, values-conflict)', () => {
    expect(adversarial.map((c) => c.id).sort()).toEqual([
      'ds-02-underqualified-staff',
      'ds-03-thin-evidence',
      'ds-04-values-conflict',
    ]);
  });

  for (const c of adversarial) {
    it(`${c.id}: sycophant is REJECTED by grounding + honesty + calibration gates`, async () => {
      const produced = await sycophantDecisionAgent.decide(
        c.profile,
        c.stateModel,
        c.opportunity,
        c.question,
      );
      const scored = scoreDecisionCase(c, produced);
      expect(scored.passed, `sycophant should not pass ${c.id}`).toBe(false);
      // At least one of: forbidden fabrication rendered, or confidence inflated
      // out of band, or dishonest "apply" recommendation.
      const tripped =
        scored.fabrications.length > 0 ||
        scored.uncalibrated ||
        !scored.honestRecommendation;
      expect(tripped, `sycophant should trip a gate for ${c.id}`).toBe(true);
    });
  }
});

// ---------- Offer comparison ----------

/** Oracle offer-comparison agent — returns exactly the expected ranking. */
const oracleOfferAgent: OfferComparisonAgent = {
  compare: (_values, _offers) => {
    const c = offerCases.find(
      (oc) => JSON.stringify(oc.candidateValues.weights) === JSON.stringify(_values.weights),
    );
    if (!c) {
      return Promise.resolve({ ranking: [], weights: {}, explanation: '', evidenceRefs: [] });
    }
    return Promise.resolve({
      ranking: [...c.expected.ranking],
      weights: { ...c.expected.weights },
      explanation: c.expected.explanation,
      evidenceRefs: [...c.expected.evidenceRefs],
    });
  },
};

/** Sycophant offer-comparison agent — pads with forbidden strings + invents weights. */
const sycophantOfferAgent: OfferComparisonAgent = {
  compare: (values, offers) => {
    const c = offerCases.find(
      (oc) => JSON.stringify(oc.candidateValues.weights) === JSON.stringify(values.weights),
    );
    const forbidden = c?.forbidden?.[0] ?? 'invented flexibility';
    return Promise.resolve({
      ranking: offers.map((o) => o.id).reverse(),
      // Invent a preference not stated by the user.
      weights: { ...values.weights, 'invented-preference': 0.5 },
      explanation: `Fabricated: ${forbidden}. Ranking reflects invented perks not in the offers.`,
      evidenceRefs: offers.map((o) => o.id),
    });
  },
};

describe('M05 offer-comparison harness — oracle passes, sycophant caught', () => {
  it('oracle offer agent passes the full suite', async () => {
    const result = await runOfferComparisonEval(oracleOfferAgent, offerCases);
    for (const c of result.cases) {
      expect(c.passed, `${c.caseId} should pass with oracle offer agent`).toBe(true);
    }
    expect(result.passed).toBe(true);
  });

  const adv = offerCases.filter((c) => c.adversarial);
  for (const c of adv) {
    it(`${c.id}: sycophant offer agent is CAUGHT (weights or fabrication)`, async () => {
      const produced = await sycophantOfferAgent.compare(c.candidateValues, c.offers);
      const scored = scoreOfferComparisonCase(c, produced);
      expect(scored.passed).toBe(false);
      // Either invented weight keys, or forbidden fabrication in explanation.
      expect(!scored.weightsMatch || !scored.noFabricatedDetails).toBe(true);
    });
  }
});

// Suppress unused import warnings for OfferComparison type
export type _KeepOfferType = OfferComparison;
