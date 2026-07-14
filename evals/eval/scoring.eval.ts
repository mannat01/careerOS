/**
 * SCORING EVAL GATE (M03 acceptance: calibrated overall band, all subscores
 * present, a grounded plain-language explanation, and reproducibility for
 * identical inputs).
 *
 * Step 2: the CURRENT agent is the REAL LlmMatchScorerAgent behind a
 * FakeLlmProvider that ACTIVELY commits the sins the golden set forbids — an
 * inflated overall (95), a fabricated evidenceRef ("f-fabricated"), and an
 * explanation that credits the candidate with the exact `forbidden` inflation
 * per case. The deterministic `groundMatchScore` guardrail must recompute the
 * honest score from the real facts vs the real requirements and drop every
 * fabrication. Turning this green proves the guardrail, not a hand-fed answer.
 *
 * Run: pnpm --filter @careeros/evals eval        (all suites)
 *      pnpm --filter @careeros/evals eval:ci     (GREEN allowlist — this suite)
 */
import { describe, expect, it } from 'vitest';
import { runScoringEval } from '../src/harness.js';
import { loadScoringCases } from '../src/datasets.js';
import { createScoringFixtureAgent } from '../src/scoring-fixture-agent.js';

const cases = loadScoringCases();
// REAL Scorer/Explainer pipeline behind FakeLlmProvider. The fake returns raw,
// over-scored, ungrounded proposals; the deterministic groundMatchScore
// guardrail must recompute an honest score before this gate can pass.
const currentAgent = createScoringFixtureAgent(cases);

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
