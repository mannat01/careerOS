/**
 * Self-validation of the M08 Step 1 intelligence-dashboard harness.
 *
 * This test runs INSIDE `pnpm -w test` (via evals/vitest.config.ts's
 * `test/**` glob) and does NOT depend on the yet-to-be-built metric
 * composer. It proves two properties of the harness itself before we
 * ever wire a real agent:
 *
 *   1. The ORACLE agent (deterministic, builds a passing metric straight
 *      from each case's expected assertions) PASSES every case. If the
 *      oracle fails any case, the HARNESS is broken (not the composer).
 *
 *   2. The CHEERLEADER/FABRICATOR agent (the "weak model" that actively
 *      commits every sin the golden set forbids — cheerleading on flat
 *      trends, ok-status on insufficient-data, nonexistent drill-down
 *      refs, nonexistent linkedPlanActionId) is CAUGHT on EVERY case
 *      (adversarial AND standard). A single case slipping past this
 *      agent is a harness escape.
 *
 * Also asserts, per the four adversarial cases (dm-09..12):
 *   - dm-09: cheerleading substrings ARE registered as explanationForbiddenHits
 *   - dm-10: fabricatedValueOnInsufficient trips
 *   - dm-11: ungroundedEvidenceRefs contains 'dm-nonexistent-ref'
 *   - dm-12: linkageError trips (linked to a nonexistent plan action)
 */
import { describe, expect, it } from 'vitest';
import {
  createCheerleaderFabricatorDashboardMetricAgent,
  createOracleDashboardMetricAgent,
} from '../src/dashboard-fixture-agents.js';
import { runDashboardMetricEval, scoreDashboardMetricCase } from '../src/dashboard-harness.js';
import { loadDashboardMetricCases } from '../src/datasets.js';

const cases = loadDashboardMetricCases();

describe('M08 dashboard-harness — self-validation (oracle passes, cheerleader/fabricator is caught)', () => {
  it('oracle agent passes every case (harness sanity — GREEN gate)', async () => {
    const oracle = createOracleDashboardMetricAgent(cases);
    const suite = await runDashboardMetricEval(oracle, cases);

    const failing = suite.cases.filter((r) => !r.passed);
    expect(
      failing,
      `Oracle should pass every case; failures indicate a broken harness. Failing cases: ${JSON.stringify(
        failing,
        null,
        2,
      )}`,
    ).toEqual([]);

    expect(suite.passed).toBe(true);
    expect(suite.groundingLeakCount).toBe(0);
    expect(suite.cheerleadingHits).toBe(0);
    expect(suite.fabricatedInsufficientCount).toBe(0);
  });

  it('cheerleader/fabricator agent is caught on EVERY case (harness catches all four failure modes)', async () => {
    const weak = createCheerleaderFabricatorDashboardMetricAgent(cases);
    const suite = await runDashboardMetricEval(weak, cases);

    // Every case must fail.
    const anyPassed = suite.cases.filter((r) => r.passed);
    expect(
      anyPassed,
      `Cheerleader/fabricator should be caught on every case. Escapees: ${JSON.stringify(
        anyPassed,
        null,
        2,
      )}`,
    ).toEqual([]);

    // The suite-level counters must all be non-zero.
    expect(suite.passed).toBe(false);
    expect(suite.groundingLeakCount).toBeGreaterThan(0);
    expect(suite.adversarialGroundingLeaks).toBeGreaterThan(0);
    expect(suite.cheerleadingHits).toBeGreaterThan(0);
    expect(suite.fabricatedInsufficientCount).toBeGreaterThan(0);
  });
});

describe('M08 adversarial cases — per-case gate specificity', () => {
  const weak = createCheerleaderFabricatorDashboardMetricAgent(cases);

  function findResultFor(caseId: string) {
    const c = cases.find((x) => x.id === caseId);
    if (!c) throw new Error(`Missing case: ${caseId}`);
    return { c, resultPromise: weak.compose(c.input).then((m) => scoreDashboardMetricCase(c, m)) };
  }

  it('dm-09-adv-cheerleader-flat-trend: explanationForbiddenHits contains a cheerleading substring', async () => {
    const { resultPromise } = findResultFor('dm-09-adv-cheerleader-flat-trend');
    const r = await resultPromise;
    expect(r.passed).toBe(false);
    const hits = r.metrics.flatMap((m) => m.explanationForbiddenHits);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => ['surging', 'crushing it', 'on fire'].includes(h))).toBe(true);
  });

  it('dm-10-adv-fabricated-no-evidence: fabricatedValueOnInsufficient trips', async () => {
    const { resultPromise } = findResultFor('dm-10-adv-fabricated-no-evidence');
    const r = await resultPromise;
    expect(r.passed).toBe(false);
    expect(r.metrics.some((m) => m.fabricatedValueOnInsufficient)).toBe(true);
  });

  it('dm-11-adv-nonexistent-evidence-ref: ungroundedEvidenceRefs contains the fabricated ref', async () => {
    const { resultPromise } = findResultFor('dm-11-adv-nonexistent-evidence-ref');
    const r = await resultPromise;
    expect(r.passed).toBe(false);
    const ungrounded = r.metrics.flatMap((m) => m.ungroundedEvidenceRefs);
    expect(ungrounded).toContain('dm-nonexistent-ref');
  });

  it('dm-12-adv-nonexistent-plan-action: linkageError trips on the fabricated action id', async () => {
    const { resultPromise } = findResultFor('dm-12-adv-nonexistent-plan-action');
    const r = await resultPromise;
    expect(r.passed).toBe(false);
    expect(r.metrics.some((m) => m.linkageError)).toBe(true);
    // The case-wide forbidden list also flags "30d-fake-action" appearing anywhere.
    expect(r.fabrications).toContain('30d-fake-action');
  });
});