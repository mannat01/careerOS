/**
 * EXTRACTION EVAL GATE (M02 acceptance: ≥90% recall per case, full provenance,
 * zero fabrication). Runs the CURRENT extraction agent against the golden set.
 *
 * Today the current agent is the deliberate stub → this gate is RED. Step 2
 * swaps in the real extractor (behind FakeLlmProvider) and must turn it green.
 * Run: pnpm --filter @careeros/evals eval   (NOT part of `pnpm -w test`)
 */
import { describe, expect, it } from 'vitest';
import { runExtractionEval } from '../src/harness.js';
import { loadExtractionCases } from '../src/datasets.js';
import { StubExtractionAgent } from '../src/stub-agents.js';

// STUB(M02): replace with the real extraction agent from packages/agents in Step 2.
const currentAgent = new StubExtractionAgent();

describe('M02 eval gate — resume extraction', async () => {
  const result = await runExtractionEval(currentAgent, loadExtractionCases());

  it(`overall recall ≥90% (got ${(result.overallRecall * 100).toFixed(1)}%)`, () => {
    expect(result.overallRecall).toBeGreaterThanOrEqual(0.9);
  });

  it(`zero fabricated facts (got ${result.fabricationCount})`, () => {
    expect(result.fabricationCount).toBe(0);
  });

  for (const c of result.cases) {
    it(`case ${c.caseId}: recall ${(c.recall * 100).toFixed(0)}%, provenance ok, no fabrication`, () => {
      expect(c.passed, JSON.stringify(c, null, 2)).toBe(true);
    });
  }
});
