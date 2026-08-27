/**
 * Track B Slice 5 — REAL-model Strategy-Planner (plan generator) campaign.
 *
 * Drives the UNCHANGED production planner path: real frontier model →
 * `LlmStrategicPlannerAgent.plan()` (prompt → parse → `groundPlanSet` guardrail)
 * → a fully RECOMPUTED `StrategyPlanSet`. The raw model proposal is discarded by
 * the guardrail; this suite records what the raw proposal attempted vs. what the
 * final grounded plan actually shipped.
 *
 * NON-CI and PAID: guarded behind `vitest.real.config.ts` (never in
 * `GREEN_EVAL_SUITES`). Each of the 12 frozen goldens + 2 real-only cases
 * (thin/sparse + borderline) runs ×3 for a variance read.
 */
import { performance } from 'node:perf_hooks';
import { LlmStrategicPlannerAgent } from '@careeros/cie-planner';
import { describe, expect, it } from 'vitest';
import { loadPlannerCases } from '../src/datasets.js';
import { createRealCampaignRuntime } from '../src/real-campaign-runtime.js';
import {
  REAL_ONLY_PLANNER_CASES,
  REAL_PLANNER_RUNS_PER_CASE,
  aggregateRealPlannerCampaign,
  formatRealPlannerCampaign,
  scoreRealPlannerSample,
  type RealPlannerSample,
} from '../src/real-planner-harness.js';
import type { PlannerCase } from '../src/types.js';

const { costUsdAt, gateway, model, provider, selectedProvider } = createRealCampaignRuntime();
const agent = new LlmStrategicPlannerAgent(gateway);
// Frozen CI goldens (rich + adversarial) PLUS the real-only thin/borderline cases.
const cases: PlannerCase[] = [...loadPlannerCases(), ...REAL_ONLY_PLANNER_CASES];
const byCase: Array<{ c: PlannerCase; samples: RealPlannerSample[] }> = [];

describe.sequential(`Track B Slice 5 — real ${selectedProvider} planner campaign (non-CI)`, () => {
  let campaignFailure: Error | undefined;
  for (const c of cases) {
    it(`${c.id} ×${REAL_PLANNER_RUNS_PER_CASE}`, async () => {
      if (campaignFailure) throw new Error(`Campaign stopped after provider failure: ${campaignFailure.message}`);
      const samples: RealPlannerSample[] = [];
      try {
        for (let run = 1; run <= REAL_PLANNER_RUNS_PER_CASE; run += 1) {
          const completionIndex = provider.completions.length;
          const started = performance.now();
          const produced = await agent.plan(c.input);
          const latencyMs = performance.now() - started;
          const completion = provider.completions[completionIndex];
          expect(completion, 'provider completion recording').toBeDefined();
          if (!completion) throw new Error('Missing provider telemetry');
          samples.push(scoreRealPlannerSample({
            c,
            run,
            rawText: completion.text,
            produced,
            response: { usage: completion.usage, costUsd: costUsdAt(completionIndex) },
            latencyMs,
          }));
        }
      } catch (error) {
        campaignFailure = error instanceof Error ? error : new Error(String(error));
        throw campaignFailure;
      }
      byCase.push({ c, samples });
      console.log(`REAL_PLANNER_CASE_JSON=${JSON.stringify({ caseId: c.id, samples })}`);
    });
  }

  it('prints aggregate and per-case measurements', () => {
    expect(byCase).toHaveLength(cases.length);
    const result = aggregateRealPlannerCampaign(model, byCase);
    expect(result.sampleCount).toBe(cases.length * REAL_PLANNER_RUNS_PER_CASE);
    // The load-bearing invariant of the whole slice: the production guardrail
    // must leave ZERO fabrications in any FINAL grounded plan.
    expect(result.fabricationLeaks, 'final-output fabrication leaks').toBe(0);
    console.log(`\nREAL_PLANNER_RESULT_JSON=${JSON.stringify(result)}\n`);
    console.log(formatRealPlannerCampaign(result));
  });
});
