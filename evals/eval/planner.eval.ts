/**
 * STRATEGY-PLANNER EVAL GATE (M06 acceptance: grounded, laddered, justified
 * plans across 30d/90d/1y/3y/5y; a single real "today's move" from the 30-day
 * plan; §4A-correct adaptivity — regenerate + explain on material change,
 * NO regeneration on sub-threshold change).
 *
 * Step 2: the REAL @careeros/cie-planner `LlmStrategicPlannerAgent` runs behind
 * a FakeLlmProvider (see planner-fixture-agent.ts). The fake ACTIVELY proposes
 * the pl-09..12 sins (invent a management-track goal, emit an ungrounded
 * blockchain/web3 action, surface an out-of-plan mass-apply "today's move", let
 * a low-impact research signal redirect the plan) plus forbidden inflation in
 * every action. The deterministic `groundPlanSet` guardrail DISCARDS the
 * proposal and recomputes the plan set from the REAL stated goals + graph nodes
 * + gaps, and `decideReplan` regenerates ONLY on a §4A material change. The
 * golden set is frozen; the guardrail is what makes this gate GREEN.
 *
 * Run: pnpm --filter @careeros/evals eval
 * CI:  pnpm --filter @careeros/evals eval:ci  (planner now enforced)
 */
import { describe, expect, it } from 'vitest';
import { runPlannerEval, scorePlannerCase, scorePlannerAdaptivityCase } from '../src/harness.js';
import { loadPlannerAdaptivityCases, loadPlannerCases } from '../src/datasets.js';
import { createPlannerFixtureAgent } from '../src/planner-fixture-agent.js';
import {
  rawPlanProposalSchema,
  rawProposalToPlanSet,
  alwaysRegenerate,
} from '@careeros/cie-planner';

const cases = loadPlannerCases();
const adaptivityCases = loadPlannerAdaptivityCases();

// Step 2: the real planner agent behind a FakeLlmProvider that ACTIVELY attempts
// the pl-09..12 sins. The guardrail turns the frozen golden set green.
const currentAgent = createPlannerFixtureAgent(cases);

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
 * FABRICATION guardrail RED-TEST — prove `groundPlanSet` / `decideReplan` are
 * LOAD-BEARING, not decorative. Build the SAME fabricated proposal the
 * FakeLlmProvider emits, but bypass the guardrail (rawProposalToPlanSet trusts
 * the model verbatim; alwaysRegenerate ignores §4A). Every sin must then LEAK
 * and trip the gate — if it doesn't, the guardrail wasn't doing the work.
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

  // The forbidden bait per adversarial case — same content the fixture emits.
  const bait: Record<string, string> = {
    'pl-09-adv-invented-goal': 'Pursue the management track — become a manager / engineering manager.',
    'pl-10-adv-ungrounded-action': 'Spin up a blockchain / web3 crypto side project to ride the hype.',
    'pl-11-adv-todays-move': 'Mass apply to 100 jobs and cold-email 50 recruiters today.',
    'pl-12-adv-lowimpact-research': 'Pivot to prompt engineering — abandon security and join a prompt engineer bootcamp.',
  };

  for (const c of adversarial) {
    it(`${c.id}: raw proposal (guardrail bypassed) is REJECTED — invented goal / ungrounded action / hustle move / forbidden strings leak`, () => {
      const b = bait[c.id] ?? '';
      const proposal = rawPlanProposalSchema.parse({
        plans: ['30d', '90d', '1y', '3y', '5y'].map((horizon) => ({
          horizon,
          objective: `Chase momentum (${horizon}). ${b}`,
          actions: [
            {
              id: `${horizon}-fab1`,
              title: `Ladder to a goal the user never stated. ${b}`,
              goalId: 'goal-invented',
              targetNodeId: 'n-nonexistent-hype',
              gapId: 'gap-nonexistent',
              metric: 'hype generated',
              rationale: `Everyone is doing it. ${b}`,
              expectedImpact: 'Vibes.',
              confidence: 0.99,
              kind: 'concrete',
            },
          ],
        })),
        todaysMove: {
          actionId: 'todays-hustle-move',
          justification: `Mass apply to 100 jobs today! ${b}`,
        },
      });
      const leaked = rawProposalToPlanSet(proposal);
      const scored = scorePlannerCase(c, leaked);
      expect(scored.passed, `bypassed guardrail must trip on ${c.id}`).toBe(false);
      expect(
        scored.inventedGoalActions.length +
          scored.ungroundedNodeActions.length +
          scored.ungroundedGapActions.length +
          scored.fabrications.length +
          (scored.todaysMoveOk ? 0 : 1),
        `at least one sin must leak for ${c.id}`,
      ).toBeGreaterThan(0);
    });
  }

  it('anti-thrash red-test: alwaysRegenerate (bypassing §4A) regenerates on a sub-threshold change', () => {
    const subThreshold = adaptivityCases.find((c) => !c.expectRegeneration);
    expect(subThreshold, 'a sub-threshold adaptivity case must exist').toBeDefined();
    const proposal = rawPlanProposalSchema.parse({ plans: [], todaysMove: { actionId: '', justification: '' } });
    const leaked = alwaysRegenerate(proposal, subThreshold!.input, subThreshold!.change);
    const scored = scorePlannerAdaptivityCase(subThreshold!, leaked);
    // With §4A bypassed, the planner regenerates when it should hold — the gate trips.
    expect(scored.decisionOk, 'bypassed §4A must thrash on the sub-threshold change').toBe(false);
  });
});