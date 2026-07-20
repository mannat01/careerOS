/**
 * INTELLIGENCE-DASHBOARD METRIC EVAL GATE (M08 Step 1 — golden-first; NO
 * metric composer yet). This gate is INTENTIONALLY RED until Step 2 lands
 * the real MetricComposer. The Step-1 stub agent returns `[]` for every
 * case, so every property gate in `dashboard-harness.ts` fails and vitest
 * reports the whole file red — that is the design.
 *
 * When Step 2 wires the real composer:
 *   1. Replace `createStubDashboardMetricAgent` with the real composer (or a
 *      FakeLlmProvider-backed fixture agent that runs the real prompt →
 *      parse → deterministic guardrail path).
 *   2. Add `eval/metrics.eval.ts` to `GREEN_EVAL_SUITES` in
 *      `evals/vitest.eval-ci.config.ts` in the SAME commit so it becomes a
 *      permanent CI gate too.
 *
 * The self-validation of the harness itself (oracle passes on every case;
 * cheerleader/fabricator agent is CAUGHT on every case) lives in
 * `evals/test/dashboard-harness.test.ts` and runs green in the DB-free
 * `pnpm -w test` today.
 *
 * Run: pnpm --filter @careeros/evals eval
 * CI:  NOT in eval:ci yet — added by Step 2.
 */
import { describe, expect, it } from 'vitest';
import { runDashboardMetricEval } from '../src/dashboard-harness.js';
import { createStubDashboardMetricAgent } from '../src/dashboard-fixture-agents.js';
import { loadDashboardMetricCases } from '../src/datasets.js';

const cases = loadDashboardMetricCases();

// Step 1 stub — replaced by the real MetricComposer in Step 2.
const currentAgent = createStubDashboardMetricAgent(cases);

describe('M08 eval gate — intelligence-dashboard metric composer (RED until Step 2)', async () => {
  const result = await runDashboardMetricEval(currentAgent, cases);

  it(`zero grounding leaks across the suite (got ${result.groundingLeakCount})`, () => {
    expect(result.groundingLeakCount).toBe(0);
  });

  it(`zero grounding leaks on the adversarial cases dm-09..12 (got ${result.adversarialGroundingLeaks})`, () => {
    expect(result.adversarialGroundingLeaks).toBe(0);
  });

  it(`zero cheerleading substrings on flat-or-declining trends across the suite (got ${result.cheerleadingHits})`, () => {
    expect(result.cheerleadingHits).toBe(0);
  });

  it(`zero fabricated-value-on-insufficient-data across the suite (got ${result.fabricatedInsufficientCount})`, () => {
    expect(result.fabricatedInsufficientCount).toBe(0);
  });

  for (const c of result.cases) {
    it(`case ${c.caseId}: grounded + explained + linked + calibrated`, () => {
      expect(c.passed, JSON.stringify(c, null, 2)).toBe(true);
    });
  }
});