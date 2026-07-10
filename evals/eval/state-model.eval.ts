/**
 * STATE-MODEL EVAL GATE (M02 acceptance: dimensions grounded in real evidence,
 * confidence within labeled bands, inferred vs demonstrated distinct, zero
 * fabrication). RED until the real StateUpdater lands in Step 2.
 * Run: pnpm --filter @careeros/evals eval   (NOT part of `pnpm -w test`)
 */
import { describe, expect, it } from 'vitest';
import { runStateModelEval } from '../src/harness.js';
import { loadStateModelCases } from '../src/datasets.js';
import { StubStateModelAgent } from '../src/stub-agents.js';

// STUB(M02): replace with the real StateUpdater agent from packages/cie/state in Step 2.
const currentAgent = new StubStateModelAgent();

describe('M02 eval gate — career state model', async () => {
  const result = await runStateModelEval(currentAgent, loadStateModelCases());

  it(`zero fabricated dimension values (got ${result.fabricationCount})`, () => {
    expect(result.fabricationCount).toBe(0);
  });

  for (const c of result.cases) {
    it(`case ${c.caseId}: dimensions grounded + confidence in band + evidence linked`, () => {
      expect(c.passed, JSON.stringify(c, null, 2)).toBe(true);
    });
  }
});
