/**
 * INTERVIEW-PREP EVAL GATE (M09 Step 2 — GREEN, CI-enforced). Step 2 replaces
 * the Step-1 RED stub with a FakeLlmProvider-backed fixture that drives the
 * REAL `LlmInterviewerAgent` (@careeros/cie-interview). The fake frontier LLM
 * ACTIVELY attempts every ip-09..12 sin on every request (fabricate the
 * K8s-scale STAR, inflate the latency metric, claim Staff/org-wide scope,
 * invent Kafka) and dumps every case's forbidden bait verbatim. The
 * DETERMINISTIC guardrail `groundInterviewPrep` defeats each — the proposal
 * is DISCARDED and the prep is recomputed from the real
 * profile/state/graph/JD inputs: gap competencies get honest_bridge (≥1 real
 * evidence) or address_gap (no evidence) — never a fabricated STAR — every
 * evidenceMap.factRef resolves against `allowedFactRefs`, and forbidden
 * claim strings are scrubbed from every rendered surface.
 *
 * Added to `GREEN_EVAL_SUITES` in `evals/vitest.eval-ci.config.ts` in the
 * same commit — this file is now a permanent CI gate.
 *
 * Run: pnpm --filter @careeros/evals eval
 * CI:  pnpm --filter @careeros/evals eval:ci
 */
import { describe, expect, it } from 'vitest';
import { runInterviewPrepEval } from '../src/interview-harness.js';
import { createInterviewerFixtureAgent } from '../src/interview-fixture-agent.js';
import { loadInterviewPrepCases } from '../src/datasets.js';

const cases = loadInterviewPrepCases();

// Step 2 fixture — drives the REAL interviewer behind a FakeLlmProvider that
// attempts every ip-09..12 sin. The deterministic guardrail defeats each.
const currentAgent = createInterviewerFixtureAgent(cases);

describe('M09 eval gate — interview-prep interviewer (GREEN, CI-enforced)', async () => {
  const result = await runInterviewPrepEval(currentAgent, cases);

  it(`zero forbidden-substring leaks across the suite (got ${result.forbiddenLeakCount})`, () => {
    expect(result.forbiddenLeakCount).toBe(0);
  });

  it(`zero forbidden leaks on the adversarial cases ip-09..12 (got ${result.adversarialForbiddenLeaks})`, () => {
    expect(result.adversarialForbiddenLeaks).toBe(0);
  });

  it(`zero ungrounded factRefs across the suite (got ${result.ungroundedFactRefCount})`, () => {
    expect(result.ungroundedFactRefCount).toBe(0);
  });

  it(`every gap competency is honestly acknowledged (unacknowledged=${result.unacknowledgedGapCount})`, () => {
    expect(result.unacknowledgedGapCount).toBe(0);
  });

  for (const c of result.cases) {
    it(`case ${c.caseId}: relevant + grounded + honest gaps + no fabrication`, () => {
      expect(c.passed, JSON.stringify(c, null, 2)).toBe(true);
    });
  }
});