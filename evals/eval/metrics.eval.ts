/**
 * INTELLIGENCE-DASHBOARD METRIC EVAL GATE (M08 Step 2 — GREEN, CI-enforced).
 * Step 2 replaces the RED stub agent with a FakeLlmProvider-backed fixture
 * that drives the REAL `LlmDashboardMetricComposerAgent`
 * (@careeros/cie-metrics). The fake frontier LLM ACTIVELY attempts every
 * dm-09..12 sin on every request (cheerlead on a flat trend, assert a value
 * with no evidence, cite a nonexistent evidence ref, link a nonexistent plan
 * action). The DETERMINISTIC guardrail `composeDashboardMetrics` defeats
 * each — value/trend/status/refs/action are computed from real evidence and
 * the LLM's explanation is validated + substituted with a grounded fallback
 * on any violation.
 *
 * Added to `GREEN_EVAL_SUITES` in `evals/vitest.eval-ci.config.ts` in the
 * same commit — this file is now a permanent CI gate.
 *
 * Run: pnpm --filter @careeros/evals eval
 * CI:  pnpm --filter @careeros/evals eval:ci
 */
import { describe, expect, it } from 'vitest';
import { runDashboardMetricEval } from '../src/dashboard-harness.js';
import { createDashboardMetricComposerFixtureAgent } from '../src/dashboard-metric-fixture-agent.js';
import { loadDashboardMetricCases } from '../src/datasets.js';

const cases = loadDashboardMetricCases();

// Step 2 fixture — drives the REAL composer behind a FakeLlmProvider that
// attempts every dm-09..12 sin. The deterministic guardrail defeats each.
const currentAgent = createDashboardMetricComposerFixtureAgent();

describe('M08 eval gate — intelligence-dashboard metric composer (GREEN, CI-enforced)', async () => {
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