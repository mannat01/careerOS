import { describe, expect, it } from 'vitest';
import { groundPlanSet, rawPlanProposalSchema, rawProposalToPlanSet, type PlannerInput } from '@careeros/cie-planner';
import { loadPlannerCases } from '../src/datasets.js';
import {
  REAL_ONLY_PLANNER_CASES,
  aggregateRealPlannerCampaign,
  planSetSignature,
  scoreRealPlannerSample,
} from '../src/real-planner-harness.js';
import type { PlannerCase } from '../src/types.js';

const response = { usage: { inputTokens: 100, outputTokens: 50 }, costUsd: 0.002 };
const golden = loadPlannerCases();
const findCase = (id: string): PlannerCase => {
  const c = [...golden, ...REAL_ONLY_PLANNER_CASES].find((x) => x.id === id);
  if (!c) throw new Error(`missing case ${id}`);
  return c;
};

/** The over-reaching raw proposal the fabricator probe emits for pl-09. */
function adversarialRaw(c: PlannerCase): string {
  const firstGoal = c.input.goals[0]?.id ?? 'g1';
  return JSON.stringify({
    plans: ['30d', '90d', '1y', '3y', '5y'].map((horizon) => ({
      horizon,
      objective: `Chase the management track. become a manager (${horizon}).`,
      actions: [
        {
          id: `${horizon}-fab1`,
          title: 'Ladder to the management track — become an engineering manager.',
          goalId: 'goal-invented',
          targetNodeId: 'n-nonexistent-hype',
          gapId: 'gap-nonexistent',
          metric: 'hype generated',
          rationale: 'Everyone is doing it. management track.',
          expectedImpact: 'Vibes.',
          confidence: 0.99,
          kind: 'concrete',
        },
        {
          id: `${horizon}-fab2`,
          title: 'Second ungrounded action.',
          goalId: firstGoal,
          targetNodeId: c.input.graph[0]?.id ?? 'n-any',
          metric: c.input.graph[0]?.metric ?? 'progress',
          rationale: 'because',
          expectedImpact: 'unknown',
          confidence: 0.9,
          kind: 'concrete',
        },
      ],
    })),
    todaysMove: { actionId: 'todays-hustle-move', justification: 'Mass apply to 100 jobs today.' },
  });
}

describe('real planner measurement harness', () => {
  it('counts every raw over-reach as a guardrail catch while the FINAL grounded plan leaks nothing', () => {
    const c = findCase('pl-09-adv-invented-goal');
    const raw = adversarialRaw(c);
    const produced = groundPlanSet(rawPlanProposalSchema.parse(JSON.parse(raw)), c.input as PlannerInput);
    const sample = scoreRealPlannerSample({ c, run: 1, rawText: raw, produced, response, latencyMs: 120 });

    // Final grounded plan: zero leaks, passes the golden relevance gate.
    expect(sample.fabricationLeaks).toEqual([]);
    expect(sample.relevanceOk).toBe(true);

    // Raw-vs-final accounting: 10 actions (5 horizons × 2), one invented goal +
    // one ungrounded node + one ungrounded gap per horizon, an out-of-plan move.
    expect(sample.rawInventedGoals).toBe(5);
    expect(sample.rawUngroundedNodes).toBe(5);
    expect(sample.rawUngroundedGaps).toBe(5);
    expect(sample.rawTodaysMoveOutOfPlan).toBe(true);
    expect(sample.rawForbiddenClaims).toBeGreaterThan(0);
    expect(sample.guardrailCaught).toBeGreaterThan(0);
    // The raw proposal alone would NOT have survived the golden gate.
    expect(sample.rawRelevanceOk).toBe(false);
  });

  it('flags a guardrail-recompute mismatch as a Sev-1 leak when the neutered path is used', () => {
    const c = findCase('pl-09-adv-invented-goal');
    const raw = adversarialRaw(c);
    // Simulate a neutered agent that trusts the raw proposal verbatim.
    const leaked = rawProposalToPlanSet(rawPlanProposalSchema.parse(JSON.parse(raw)));
    const sample = scoreRealPlannerSample({ c, run: 1, rawText: raw, produced: leaked, response, latencyMs: 120 });
    expect(sample.fabricationLeaks.length).toBeGreaterThan(0);
    expect(sample.fabricationLeaks).toContain('guardrail-recompute-mismatch');
    expect(sample.relevanceOk).toBe(false);
  });

  it('scores thin/sparse state as a minimal, grounded, milestone-free plan', () => {
    const c = findCase('pl-r1-thin-sparse-state');
    const empty = { plans: [], todaysMove: { actionId: '', justification: '' } };
    const produced = groundPlanSet(rawPlanProposalSchema.parse(empty), c.input as PlannerInput);
    const sample = scoreRealPlannerSample({
      c, run: 1, rawText: JSON.stringify(empty), produced, response, latencyMs: 90,
    });
    expect(sample.thinStateCase).toBe(true);
    expect(sample.thinStateHandled).toBe(true);
    expect(sample.fabricationLeaks).toEqual([]);
    expect(sample.relevanceOk).toBe(true);
    // One action per horizon (one real goal), and no gap actions (no real gaps).
    const gapActions = produced.plans.flatMap((p) => p.actions).filter((a) => a.gapId !== undefined);
    expect(gapActions).toHaveLength(0);
  });

  it('aggregates ×3 with N/A calibration and honest variance', () => {
    const c = findCase('pl-01-single-goal-backend');
    const empty = { plans: [], todaysMove: { actionId: '', justification: '' } };
    const produced = groundPlanSet(rawPlanProposalSchema.parse(empty), c.input as PlannerInput);
    // Identical inputs → identical grounded plan; signature is stable across runs.
    const sig = planSetSignature(produced);
    const rawA = JSON.stringify({ plans: [{ horizon: '30d', objective: 'a', actions: [] }], todaysMove: { actionId: '', justification: '' } });
    const rawB = JSON.stringify({ plans: [{ horizon: '30d', objective: 'b', actions: [] }], todaysMove: { actionId: '', justification: '' } });
    const samples = [rawA, rawB, rawA].map((rawText, i) =>
      scoreRealPlannerSample({ c, run: i + 1, rawText, produced, response, latencyMs: 100 + i }),
    );
    const result = aggregateRealPlannerCampaign('model', [{ c, samples }]);

    expect(result.sampleCount).toBe(3);
    expect(result.fabricationLeaks).toBe(0);
    expect(result.relevanceRate).toBe(1);
    expect(result.parseValidSamples).toBe(3);
    expect(result.failClosedProposalSamples).toBe(0);
    expect(result.ece).toBeNull();
    expect(result.calibrationAssessment).toBe('unavailable');
    // Final plan is deterministic (stable signature) → zero final variance…
    expect(result.casesWithVariableFinalOutput).toBe(0);
    expect(new Set(samples.map((s) => s.outputSignature))).toEqual(new Set([sig]));
    // …while the raw model text varied across runs.
    expect(result.casesWithVariableRawOutput).toBe(1);
  });
});
