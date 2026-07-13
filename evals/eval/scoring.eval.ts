/**
 * SCORING EVAL GATE (M03 acceptance: calibrated overall band, all subscores
 * present, a grounded plain-language explanation, and reproducibility for
 * identical inputs).
 *
 * The CURRENT agent is the deliberate stub → this gate is RED. Step 2 swaps in
 * the real Scorer/Explainer and must turn it green WITHOUT editing the golden
 * set.
 * Run: pnpm --filter @careeros/evals eval   (NOT part of `pnpm -w test`)
 */
import { describe, expect, it } from 'vitest';
import { runScoringEval } from '../src/harness.js';
import { loadScoringCases } from '../src/datasets.js';
import { StubScoringAgent } from '../src/resume-agents.js';

// Step 2: replace with the REAL Scorer agent (behind FakeLlmProvider).
const currentAgent = new StubScoringAgent();
const cases = loadScoringCases();

describe('M03 eval gate — match scoring', async () => {
  const result = await runScoringEval(currentAgent, cases);

  it(`zero fabricated qualifications in explanations (got ${result.fabricationCount})`, () => {
    expect(result.fabricationCount).toBe(0);
  });

  it(`every score is reproducible for identical inputs (${result.nonReproducible} non-reproducible)`, () => {
    expect(result.nonReproducible).toBe(0);
  });

  for (const c of result.cases) {
    it(`case ${c.caseId}: band + subscores + grounded explanation + reproducible`, () => {
      expect(c.passed, JSON.stringify(c, null, 2)).toBe(true);
    });
  }
});
