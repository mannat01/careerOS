/**
 * STRATEGY-PLANNER EVAL GATE (M06 acceptance: grounded, laddered, justified
 * plans across 30d/90d/1y/3y/5y; a single real "today's move" from the 30-day
 * plan; §4A-correct adaptivity — regenerate + explain on material change,
 * NO regeneration on sub-threshold change).
 *
 * Step 1: the CURRENT agent is the deliberate stub → this gate is RED.
 * Step 2 swaps in the real Planner agent and must turn it green WITHOUT
 * editing the golden set. Deliberately NOT in the eval:ci allowlist
 * (vitest.eval-ci.config.ts) until then.
 * Run: pnpm --filter @careeros/evals eval   (NOT part of `pnpm -w test`)
 */
import { describe, expect, it } from 'vitest';
import { runPlannerEval, scorePlannerCase } from '../src/harness.js';
import { loadPlannerAdaptivityCases, loadPlannerCases } from '../src/datasets.js';
import { fabricatorPlannerAgent, StubPlannerAgent } from '../src/planner-agents.js';

const cases = loadPlannerCases();
const adaptivityCases = loadPlannerAdaptivityCases();

// Step 1: deliberate stub — RED by design. Step 2 replaces this with the real
// packages/cie/planner agent (behind a FakeLlmProvider) and turns it green
// against the FROZEN golden set.
const currentAgent = new StubPlannerAgent();

describe('M06 eval gate — career strategy planner', async () => {
  const result = await runPlannerEval(currentAgent, cases, adaptivityCases);

  it(`zero invented goals / ungrounded actions / forbidden strings across the suite (got ${result.fabricationCount})`, () => {
    expect(result.fabricationCount).toBe(0);
  });

  it(`zero fabrication on the adversarial pressure cases (got ${result.adversarialFabrications})`, () => {
    expect(result.adversarialFabrications).toBe(0);
  });

  it(`zero regeneration thrash on sub-threshold changes (got ${result.thrashCount})`, () => {
    expect(result.thrashCount).toBe(0);
  });

  for (const c of result.cases) {
    it(`case ${c.caseId}: grounded + laddered + justified + real today's move`, () => {
      expect(c.passed, JSON.stringify(c, null, 2)).toBe(true);
    });
  }

  for (const c of result.adaptivityCases) {
    it(`adaptivity ${c.caseId}: ${c.material ? 'regenerates with explanation' : 'holds steady (no thrash)'}`, () => {
      expect(c.passed, JSON.stringify(c, null, 2)).toBe(true);
    });
  }
});

/**
 * FABRICATION guardrail probe — prove the gate is exercised by a REAL
 * goal-inventing / hype-chasing attempt, not by the stub simply producing
 * nothing. The fabricator ladders to an invented goal, targets nonexistent
 * nodes/gaps, and surfaces a hustle "today's move" outside the 30-day plan —
 * the grounding gates MUST catch every one.
 */
describe('M06 fabrication guardrail — the fabricator is caught (pl-09..12)', () => {
  const adversarial = cases.filter((c) => c.adversarial);

  it('covers all four "pressure to fabricate" cases', () => {
    expect(adversarial.map((c) => c.id).sort()).toEqual([
      'pl-09-adv-invented-goal',
      'pl-10-adv-ungrounded-action',
      'pl-11-adv-todays-move',
      'pl-12-adv-lowimpact-research',
    ]);
  });

  for (const c of adversarial) {
    it(`${c.id}: a fabricated plan is REJECTED by the grounding gates`, async () => {
      const produced = await fabricatorPlannerAgent.plan(c.input);
      const scored = scorePlannerCase(c, produced);
      expect(scored.passed).toBe(false);
      expect(
        scored.inventedGoalActions.length +
          scored.ungroundedNodeActions.length +
          scored.ungroundedGapActions.length +
          scored.fabrications.length +
          (scored.todaysMoveOk ? 0 : 1),
        `fabricator should trip the gate for ${c.id}`,
      ).toBeGreaterThan(0);
    });
  }
});