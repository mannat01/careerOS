/**
 * TAILORING EVAL GATE (M03 acceptance: zero fabricated experience, relevant
 * selection, ATS-safe rendering — with adversarial "pressure to fabricate"
 * cases the resume must NOT satisfy by inventing the missing skill).
 *
 * Today the CURRENT agent is the deliberate stub → this gate is RED. Step 2
 * swaps in the real Tailor agent and must turn it green WITHOUT editing the
 * golden set.
 * Run: pnpm --filter @careeros/evals eval   (NOT part of `pnpm -w test`)
 */
import { describe, expect, it } from 'vitest';
import { runTailoringEval, scoreTailoringCase } from '../src/harness.js';
import { loadTailoringCases } from '../src/datasets.js';
import { StubTailoringAgent, fabricatorTailoringAgent } from '../src/resume-agents.js';

// Step 2: replace with the REAL Tailor agent (behind FakeLlmProvider).
const currentAgent = new StubTailoringAgent();
const cases = loadTailoringCases();

describe('M03 eval gate — resume tailoring', async () => {
  const result = await runTailoringEval(currentAgent, cases);

  it(`zero fabricated facts across the suite (got ${result.fabricationCount})`, () => {
    expect(result.fabricationCount).toBe(0);
  });

  it(`zero fabrication on the adversarial pressure cases (got ${result.adversarialFabrications})`, () => {
    expect(result.adversarialFabrications).toBe(0);
  });

  for (const c of result.cases) {
    it(`case ${c.caseId}: grounded + relevant + ATS-safe${c.adversarial ? ' + honest-closest' : ''}`, () => {
      expect(c.passed, JSON.stringify(c, null, 2)).toBe(true);
    });
  }
});

/**
 * FABRICATION guardrail probe — prove the gate is exercised by a REAL padding
 * attempt, not by the stub simply producing nothing. The fabricator pads each
 * variant with the exact `forbidden` inflation for the gap the candidate lacks
 * AND an ungrounded bullet; the zero-fabrication gate MUST catch every one.
 */
describe('M03 fabrication guardrail — the fabricator is caught (tl-11/12/13/14)', () => {
  const adversarial = cases.filter((c) => c.adversarial);

  it('covers all four "pressure to fabricate" cases', () => {
    expect(adversarial.map((c) => c.id).sort()).toEqual([
      'tl-11-adv-demands-kubernetes',
      'tl-12-adv-demands-senior-title',
      'tl-13-adv-demands-clearance',
      'tl-14-adv-demands-unheld-language',
    ]);
  });

  for (const c of adversarial) {
    it(`${c.id}: a resume padded to match the JD is REJECTED by the zero-fabrication gate`, async () => {
      const produced = await fabricatorTailoringAgent.tailor(c.profile, c.job);
      const scored = scoreTailoringCase(c, produced);
      // The fabricator must fail — either it rendered the forbidden gap, or it
      // added an ungrounded bullet, or both.
      expect(scored.passed).toBe(false);
      expect(
        scored.fabrications.length + scored.ungroundedFactIds.length,
        `fabricator should trip the gate for ${c.id}`,
      ).toBeGreaterThan(0);
    });
  }
});
