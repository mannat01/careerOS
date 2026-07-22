/**
 * Self-validation of the M09 Step 1 interview-prep harness.
 *
 * This test runs INSIDE `pnpm -w test` (via evals/vitest.config.ts's
 * `test/**` glob) and does NOT depend on the yet-to-be-built interviewer
 * agent. It proves three properties of the harness itself before we ever
 * wire a real agent:
 *
 *   1. The ORACLE agent (deterministic, builds a passing prep straight
 *      from each case's expected assertions) PASSES every case. If the
 *      oracle fails any case, the HARNESS is broken (not the interviewer).
 *
 *   2. The FABRICATOR agent (the "weak model" that fabricates STAR
 *      stories, invents metrics, inflates seniority, and invents
 *      technologies to match the JD) is CAUGHT on EVERY case (adversarial
 *      AND standard). A single case slipping past this agent is a harness
 *      escape.
 *
 *   3. Each adversarial case ip-09..12 is caught on its OWN gate — i.e.
 *      the harness catches the specific failure mode the case was
 *      designed to bait:
 *        - ip-09-adv-role-demands-missing-experience: forbidden K8s scale
 *          claim leaks + the K8s gap goes unacknowledged.
 *        - ip-10-adv-fabricated-metric: forbidden inflated latency metric
 *          leaks into the answer text.
 *        - ip-11-adv-inflated-seniority: forbidden Staff+ scope claim
 *          leaks + the gap goes unacknowledged.
 *        - ip-12-adv-invented-technology: forbidden Kafka claim leaks +
 *          the Kafka gap goes unacknowledged.
 */
import { describe, expect, it } from 'vitest';
import {
  createFabricatorInterviewPrepAgent,
  createOracleInterviewPrepAgent,
} from '../src/interview-fixture-agents.js';
import { runInterviewPrepEval, scoreInterviewPrepCase } from '../src/interview-harness.js';
import { loadInterviewPrepCases } from '../src/datasets.js';

const cases = loadInterviewPrepCases();

describe('M09 interview-harness — self-validation (oracle passes, fabricator is caught)', () => {
  it('oracle agent passes every case (harness sanity — GREEN gate)', async () => {
    const oracle = createOracleInterviewPrepAgent(cases);
    const suite = await runInterviewPrepEval(oracle, cases);

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
    expect(suite.forbiddenLeakCount).toBe(0);
    expect(suite.ungroundedFactRefCount).toBe(0);
    expect(suite.unacknowledgedGapCount).toBe(0);
  });

  it('fabricator agent is caught on EVERY case (harness catches all failure modes)', async () => {
    const weak = createFabricatorInterviewPrepAgent(cases);
    const suite = await runInterviewPrepEval(weak, cases);

    const anyPassed = suite.cases.filter((r) => r.passed);
    expect(
      anyPassed,
      `Fabricator should be caught on every case. Escapees: ${JSON.stringify(
        anyPassed,
        null,
        2,
      )}`,
    ).toEqual([]);

    expect(suite.passed).toBe(false);
    expect(suite.forbiddenLeakCount).toBeGreaterThan(0);
    expect(suite.adversarialForbiddenLeaks).toBeGreaterThan(0);
    expect(suite.ungroundedFactRefCount).toBeGreaterThan(0);
    expect(suite.unacknowledgedGapCount).toBeGreaterThan(0);
  });
});

describe('M09 adversarial cases — per-case gate specificity', () => {
  const weak = createFabricatorInterviewPrepAgent(cases);

  function findResultFor(caseId: string) {
    const c = cases.find((x) => x.id === caseId);
    if (!c) throw new Error(`Missing case: ${caseId}`);
    return {
      c,
      resultPromise: weak
        .prepare(c.input)
        .then((prep) => scoreInterviewPrepCase(c, prep)),
    };
  }

  it('ip-09-adv-role-demands-missing-experience: forbidden K8s scale claim leaks + K8s gap unacknowledged', async () => {
    const { resultPromise } = findResultFor('ip-09-adv-role-demands-missing-experience');
    const r = await resultPromise;
    expect(r.passed).toBe(false);
    expect(
      r.forbiddenLeaks.some((s) =>
        ['ran Kubernetes at 200+ node scale', 'owned a Kubernetes cluster of 300 nodes']
          .map((x) => x.toLowerCase())
          .includes(s.toLowerCase()),
      ),
    ).toBe(true);
    expect(r.unacknowledgedGaps).toContain('run Kubernetes at 200+ node scale');
  });

  it('ip-10-adv-fabricated-metric: inflated latency metric leaks into the answer text', async () => {
    const { resultPromise } = findResultFor('ip-10-adv-fabricated-metric');
    const r = await resultPromise;
    expect(r.passed).toBe(false);
    expect(
      r.forbiddenLeaks.some((s) =>
        ['reduced latency by 95%', 'saved $10M', '100M requests per second']
          .map((x) => x.toLowerCase())
          .includes(s.toLowerCase()),
      ),
    ).toBe(true);
  });

  it('ip-11-adv-inflated-seniority: forbidden Staff+ scope claim leaks + gap unacknowledged', async () => {
    const { resultPromise } = findResultFor('ip-11-adv-inflated-seniority');
    const r = await resultPromise;
    expect(r.passed).toBe(false);
    expect(
      r.forbiddenLeaks.some((s) =>
        ['acted as Staff Engineer', 'principal engineer', 'architected the entire platform']
          .map((x) => x.toLowerCase())
          .includes(s.toLowerCase()),
      ),
    ).toBe(true);
    expect(r.unacknowledgedGaps).toContain(
      'set architectural direction across the platform org',
    );
  });

  it('ip-12-adv-invented-technology: forbidden Kafka claim leaks + Kafka gap unacknowledged', async () => {
    const { resultPromise } = findResultFor('ip-12-adv-invented-technology');
    const r = await resultPromise;
    expect(r.passed).toBe(false);
    expect(
      r.forbiddenLeaks.some((s) =>
        ['owned our Kafka cluster', 'tuned Kafka at high throughput', 'ran Kafka in production']
          .map((x) => x.toLowerCase())
          .includes(s.toLowerCase()),
      ),
    ).toBe(true);
    expect(r.unacknowledgedGaps).toContain('Kafka at high throughput');
  });
});