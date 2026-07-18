/**
 * RESEARCH-SYNTHESIS EVAL GATE (M07 Step 1 — golden-first; the real research
 * agent lands in Step 2). Until Step 2 wires the fixture-provider synthesizer +
 * `groundResearchSynthesis` guardrail, this gate is RED BY DESIGN: it runs the
 * StubResearchSynthesisAgent (empty output), which fails every case on
 * grounding + personalization + actionability. The stub failing IS the point:
 * it proves the gate is armed, not that the real agent has landed.
 *
 * The M07 workorder acceptance is the property-based bar (grounding /
 * personalization / actionability / calibration) enforced by the harness in
 * `evals/src/harness.ts` and validated by the oracle-vs-fabricator self-tests
 * in `evals/test/research-harness.test.ts`.
 *
 * NOT added to `GREEN_EVAL_SUITES` in `evals/vitest.eval-ci.config.ts` — the
 * eval:ci gate MUST stay green (existing 138), so this suite runs only in the
 * unblocked `eval` config until the Step-2 agent lands and turns it green.
 *
 * Run: pnpm --filter @careeros/evals eval
 * (Excluded from eval:ci until Step 2.)
 */
import { describe, expect, it } from 'vitest';
import { runResearchSynthesisEval } from '../src/harness.js';
import { loadResearchSynthesisCases } from '../src/datasets.js';
import { StubResearchSynthesisAgent } from '../src/research-agents.js';

const cases = loadResearchSynthesisCases();

describe('M07 research-synthesis eval gate (RED until Step 2)', () => {
  it('every case must pass the grounding/personalization/actionability/calibration bar', async () => {
    const result = await runResearchSynthesisEval(new StubResearchSynthesisAgent(), cases);
    // These are the M07 acceptance checks the Step-2 agent must satisfy.
    expect(result.fabricationCount).toBe(0);
    expect(result.adversarialFabrications).toBe(0);
    expect(result.genericInsightCount).toBe(0);
    expect(result.overclaimCount).toBe(0);
    expect(result.passed).toBe(true);
  });
});