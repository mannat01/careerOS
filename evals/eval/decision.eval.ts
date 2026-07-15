/**
 * DECISION-SUPPORT EVAL GATE (M05 acceptance: evidence grounded, honest recommendation,
 * calibrated confidence, optionality considered — with adversarial cases the reasoner
 * must NOT satisfy by fabricating evidence or inflating confidence).
 *
 * Step 2: the CURRENT agent is the deliberate stub → this gate is RED. Step 2 swaps in
 * the real reasoner (behind FakeLlmProvider) and must turn it green WITHOUT editing
 * the golden set.
 * Run: pnpm --filter @careeros/evals eval   (NOT part of `pnpm -w test`)
 */
import { describe, expect, it } from 'vitest';
import { runDecisionEval, scoreDecisionCase } from '../src/harness.js';
import { loadDecisionCases } from '../src/datasets.js';
import { StubDecisionAgent, sycophantDecisionAgent } from '../src/decision-agents.js';

const cases = loadDecisionCases();
// Step 1 (golden-first): NO reasoner exists yet. The current agent is a
// deliberate stub → this gate is RED-by-design. Step 2 will swap in the real
// reasoner (behind FakeLlmProvider) and must turn it green WITHOUT editing the
// golden set.
const currentAgent = new StubDecisionAgent();


describe('M05 eval gate — decision support', async () => {
  const result = await runDecisionEval(currentAgent, cases);

  it(`zero fabricated evidence across the suite (got ${result.fabricationCount})`, () => {
    expect(result.fabricationCount).toBe(0);
  });

  it(`zero fabrication on the adversarial pressure cases (got ${result.adversarialFabrications})`, () => {
    expect(result.adversarialFabrications).toBe(0);
  });

  it(`all cases have calibrated confidence (got ${result.uncalibratedCount} uncalibrated)`, () => {
    expect(result.uncalibratedCount).toBe(0);
  });

  for (const c of result.cases) {
    it(`case ${c.caseId}: evidence grounded + honest recommendation + calibrated confidence + optionality considered`, () => {
      expect(c.passed, JSON.stringify(c, null, 2)).toBe(true);
    });
  }
});

/**
 * FABRICATION guardrail probe — prove the gate is exercised by a REAL padding
 * attempt, not by the stub simply producing nothing. The sycophant pads each
 * variant with the exact `forbidden` inflation for the gap the candidate lacks
 * AND inflates confidence; the zero-fabrication gate MUST catch every one.
 */
describe('M05 fabrication guardrail — the sycophant is caught (ds-02/03/04)', () => {
  const adversarial = cases.filter((c) => c.adversarial);

  it('covers all three "pressure to fabricate" cases', () => {
    expect(adversarial.map((c) => c.id).sort()).toEqual([
      'ds-02-underqualified-staff',
      'ds-03-thin-evidence',
      'ds-04-values-conflict',
    ]);
  });

  for (const c of adversarial) {
    it(`${c.id}: a decision padded to match the expectation is REJECTED by the zero-fabrication gate`, async () => {
      const produced = await sycophantDecisionAgent.decide(
        c.profile,
        c.stateModel,
        c.opportunity,
        c.question
      );
      const scored = scoreDecisionCase(c, produced);
      // The sycophant must fail — it rendered forbidden strings or inflated confidence.
      expect(scored.passed).toBe(false);
      expect(
        scored.fabrications.length + (scored.uncalibrated ? 1 : 0),
        `sycophant should trip the gate for ${c.id}`,
      ).toBeGreaterThan(0);
    });
  }
});