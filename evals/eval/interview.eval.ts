/**
 * INTERVIEW-PREP EVAL GATE (M09 Step 1 — golden-first; NO interviewer agent
 * yet). This gate is INTENTIONALLY RED until Step 2 lands the real
 * interviewer. The Step-1 stub agent returns `{ questions: [], answers: [] }`
 * for every case, so every property gate in `interview-harness.ts` fails and
 * vitest reports the whole file red — that is the design.
 *
 * When Step 2 wires the real interviewer:
 *   1. Replace `createStubInterviewPrepAgent` with the real interviewer
 *      agent (or a FakeLlmProvider-backed fixture agent running the real
 *      prompt → parse → deterministic guardrail path).
 *   2. Add `eval/interview.eval.ts` to `GREEN_EVAL_SUITES` in
 *      `evals/vitest.eval-ci.config.ts` in the SAME commit so it becomes a
 *      permanent CI gate too.
 *
 * The self-validation of the harness itself (oracle passes on every case;
 * fabricator is CAUGHT on every case, each adversarial case on its own gate)
 * lives in `evals/test/interview-harness.test.ts` and runs green in the
 * DB-free `pnpm -w test` today.
 *
 * Run: pnpm --filter @careeros/evals eval
 * CI:  NOT in eval:ci yet — added by Step 2.
 */
import { describe, expect, it } from 'vitest';
import { runInterviewPrepEval } from '../src/interview-harness.js';
import { createStubInterviewPrepAgent } from '../src/interview-fixture-agents.js';
import { loadInterviewPrepCases } from '../src/datasets.js';

const cases = loadInterviewPrepCases();

// Step 1 stub — replaced by the real interviewer agent in Step 2.
const currentAgent = createStubInterviewPrepAgent(cases);

describe('M09 eval gate — interview-prep interviewer (RED until Step 2)', async () => {
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