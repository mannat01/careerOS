import { performance } from 'node:perf_hooks';
import { LlmMatchScorerAgent } from '@careeros/cie-resume';
import { describe, expect, it } from 'vitest';
import { loadScoringCases } from '../src/datasets.js';
import { createRealCampaignRuntime } from '../src/real-campaign-runtime.js';
import {
  aggregateRealScoringCampaign,
  formatRealScoringCampaign,
  REAL_SCORING_RUNS_PER_CASE,
  scoreRealScoringSample,
  type RealScoringSample,
} from '../src/real-scoring-harness.js';

const { costUsdAt, gateway, model, provider, selectedProvider } = createRealCampaignRuntime();
const agent = new LlmMatchScorerAgent(gateway);
const cases = loadScoringCases();
const byCase: Array<{ c: (typeof cases)[number]; samples: RealScoringSample[] }> = [];

describe.sequential(`Track B Slice 3 — real ${selectedProvider} scoring campaign (non-CI)`, () => {
  let campaignFailure: Error | undefined;
  for (const c of cases) {
    it(`${c.id} ×${REAL_SCORING_RUNS_PER_CASE}`, async () => {
      if (campaignFailure) throw new Error(`Campaign stopped after provider failure: ${campaignFailure.message}`);
      const samples: RealScoringSample[] = [];
      try {
        for (let run = 1; run <= REAL_SCORING_RUNS_PER_CASE; run += 1) {
          const completionIndex = provider.completions.length;
          const started = performance.now();
          const produced = await agent.score(c.profile, c.job);
          const latencyMs = performance.now() - started;
          const completion = provider.completions[completionIndex];
          expect(completion, 'provider completion recording').toBeDefined();
          if (!completion) throw new Error('Missing provider telemetry');
          samples.push(scoreRealScoringSample({
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
      console.log(`REAL_SCORING_CASE_JSON=${JSON.stringify({ caseId: c.id, samples })}`);
    });
  }

  it('prints aggregate and per-case measurements', () => {
    expect(byCase).toHaveLength(cases.length);
    const result = aggregateRealScoringCampaign(model, byCase);
    expect(result.sampleCount).toBe(cases.length * REAL_SCORING_RUNS_PER_CASE);
    console.log(`\nREAL_SCORING_RESULT_JSON=${JSON.stringify(result)}\n`);
    console.log(formatRealScoringCampaign(result));
  });
});
