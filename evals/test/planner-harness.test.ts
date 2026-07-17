/**
 * M06 strategy-planner harness self-tests — prove the scorer discriminates
 * good from bad BEFORE the real planner exists. If these can't catch a
 * fabricator (invented goals / ungrounded actions / hustle today's-move /
 * regeneration thrash) or reward an oracle, the eval gate is decorative.
 *
 *   - oracle → passes every plan case AND every §4A adaptivity case;
 *   - fabricator → CAUGHT on every case (invented goal, ungrounded action,
 *     forbidden strings, today's-move outside the 30d plan) and CAUGHT
 *     regenerating on trivial changes (thrash);
 *   - stub → RED across the board (pre-Step-2).
 */
import { describe, expect, it } from 'vitest';
import {
  isMaterialChange,
  runPlannerEval,
  scorePlannerAdaptivityCase,
  scorePlannerCase,
} from '../src/harness.js';
import { loadPlannerAdaptivityCases, loadPlannerCases } from '../src/datasets.js';
import {
  fabricatorPlannerAgent,
  oraclePlannerAgent,
  StubPlannerAgent,
} from '../src/planner-agents.js';

const cases = loadPlannerCases();
const adaptivityCases = loadPlannerAdaptivityCases();

describe('M06 planner harness — oracle passes every case', () => {
  it('oracle planner passes the full suite (grounded, laddered, justified, adaptive per §4A)', async () => {
    const result = await runPlannerEval(oraclePlannerAgent, cases, adaptivityCases);
    expect(result.fabricationCount).toBe(0);
    expect(result.adversarialFabrications).toBe(0);
    expect(result.thrashCount).toBe(0);
    for (const c of result.cases) {
      expect(c.passed, `${c.caseId} should pass with oracle: ${JSON.stringify(c)}`).toBe(true);
    }
    for (const c of result.adaptivityCases) {
      expect(c.passed, `${c.caseId} should pass with oracle: ${JSON.stringify(c)}`).toBe(true);
    }
    expect(result.passed).toBe(true);
  });
});

describe('M06 planner harness — stub is RED (pre-Step-2)', () => {
  it('stub planner fails every plan case (no horizons, no today\'s move)', async () => {
    const result = await runPlannerEval(new StubPlannerAgent(), cases, adaptivityCases);
    expect(result.passed).toBe(false);
    expect(result.cases.every((c) => !c.passed)).toBe(true);
    // The stub never regenerates → it fails exactly the MATERIAL adaptivity cases.
    for (const c of result.adaptivityCases) {
      expect(c.passed, c.caseId).toBe(!c.material);
    }
  });
});

describe('M06 planner harness — the fabricator is CAUGHT', () => {
  it('adversarial coverage matches the workorder (invented goal, ungrounded action, today\'s move, low-impact research)', () => {
    const adv = cases.filter((c) => c.adversarial);
    expect(adv.map((c) => c.id).sort()).toEqual([
      'pl-09-adv-invented-goal',
      'pl-10-adv-ungrounded-action',
      'pl-11-adv-todays-move',
      'pl-12-adv-lowimpact-research',
    ]);
  });

  for (const c of cases) {
    it(`${c.id}: fabricator plan is REJECTED (invented goal + ungrounded action + fake today's move)`, async () => {
      const produced = await fabricatorPlannerAgent.plan(c.input);
      const scored = scorePlannerCase(c, produced);
      expect(scored.passed, `fabricator should not pass ${c.id}`).toBe(false);
      // The structural grounding gates must trip on EVERY case:
      expect(scored.inventedGoalActions.length, 'invented-goal actions caught').toBeGreaterThan(0);
      expect(scored.ungroundedNodeActions.length, 'ungrounded node actions caught').toBeGreaterThan(0);
      expect(scored.ungroundedGapActions.length, 'ungrounded gap actions caught').toBeGreaterThan(0);
      expect(scored.todaysMoveOk, "today's move outside the 30d plan caught").toBe(false);
    });
  }

  it('fabricator leaks the forbidden strings on every adversarial case (lexical gate trips too)', async () => {
    for (const c of cases.filter((x) => x.adversarial)) {
      const produced = await fabricatorPlannerAgent.plan(c.input);
      const scored = scorePlannerCase(c, produced);
      expect(scored.fabrications.length, `${c.id} forbidden strings caught`).toBeGreaterThan(0);
    }
  });

  it('fabricator regenerates on trivial changes → thrash is CAUGHT on every sub-threshold case', async () => {
    for (const c of adaptivityCases.filter((x) => !x.expectRegeneration)) {
      const prior = await fabricatorPlannerAgent.plan(c.input);
      const produced = await fabricatorPlannerAgent.replan(c.input, prior, c.change);
      const scored = scorePlannerAdaptivityCase(c, produced);
      expect(scored.passed, `${c.id}: thrash should be caught`).toBe(false);
      expect(scored.decisionOk).toBe(false);
    }
  });

  it('fabricator regenerates WITHOUT an explanation → caught on material cases too', async () => {
    for (const c of adaptivityCases.filter((x) => x.expectRegeneration)) {
      const prior = await fabricatorPlannerAgent.plan(c.input);
      const produced = await fabricatorPlannerAgent.replan(c.input, prior, c.change);
      const scored = scorePlannerAdaptivityCase(c, produced);
      // Right decision (regenerate) but empty diff explanation → still fails.
      expect(scored.passed, `${c.id}: unexplained regeneration should fail`).toBe(false);
      expect(scored.explanationOk).toBe(false);
    }
  });
});

describe('M06 planner harness — §4A material-change predicate', () => {
  it('goal add/remove is material', () => {
    expect(isMaterialChange({ type: 'goal-added', goal: { id: 'g9', statement: 'x' } })).toBe(true);
    expect(isMaterialChange({ type: 'goal-removed', goalId: 'g1' })).toBe(true);
  });

  it('state confidence shift is material iff |delta| ≥ 0.2', () => {
    expect(isMaterialChange({ type: 'state-confidence-shift', dimension: 'd', delta: 0.2 })).toBe(true);
    expect(isMaterialChange({ type: 'state-confidence-shift', dimension: 'd', delta: -0.3 })).toBe(true);
    expect(isMaterialChange({ type: 'state-confidence-shift', dimension: 'd', delta: 0.19 })).toBe(false);
  });

  it('required-skill edge is material iff on ≥2 target roles', () => {
    expect(isMaterialChange({ type: 'required-skill-edge', skill: 's', targetRoleCount: 2 })).toBe(true);
    expect(isMaterialChange({ type: 'required-skill-edge', skill: 's', targetRoleCount: 1 })).toBe(false);
  });

  it('research is material iff high-impact; cosmetic edits never are', () => {
    expect(isMaterialChange({ type: 'research-finding', impact: 'high', summary: 's' })).toBe(true);
    expect(isMaterialChange({ type: 'research-finding', impact: 'low', summary: 's' })).toBe(false);
    expect(isMaterialChange({ type: 'cosmetic-edit', description: 'typo' })).toBe(false);
  });
});