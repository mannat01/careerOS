import { performance } from 'node:perf_hooks';
import { LlmTailorAgent } from '@careeros/cie-resume';
import { describe, expect, it } from 'vitest';
import { loadTailoringCases } from '../src/datasets.js';
import { createRealCampaignRuntime } from '../src/real-campaign-runtime.js';
import {
  aggregateRealTailoringCampaign,
  formatRealTailoringCampaign,
  REAL_TAILORING_RUNS_PER_CASE,
  scoreRealTailoringSample,
  type RealTailoringSample,
} from '../src/real-tailoring-harness.js';

const { costUsdAt, gateway, model, provider, selectedProvider } = createRealCampaignRuntime();
const agent = new LlmTailorAgent(gateway);
const cases = loadTailoringCases();
const byCase: Array<{ c: (typeof cases)[number]; samples: RealTailoringSample[] }> = [];

describe.sequential(`Track B Slice 2 — real ${selectedProvider} tailoring campaign (non-CI)`, () => {
  let campaignFailure: Error | undefined;
  for (const c of cases) {
    it(`${c.id} ×${REAL_TAILORING_RUNS_PER_CASE}`, async () => {
      if (campaignFailure) throw new Error(`Campaign stopped after provider failure: ${campaignFailure.message}`);
      const samples: RealTailoringSample[] = [];
      try {
        for (let run = 1; run <= REAL_TAILORING_RUNS_PER_CASE; run += 1) {
          const completionIndex = provider.completions.length;
          const started = performance.now();
          const produced = await agent.tailorVariant(c.profile, c.job);
          const latencyMs = performance.now() - started;
          const completion = provider.completions[completionIndex];
          expect(completion, 'provider completion recording').toBeDefined();
          if (!completion) throw new Error('Missing provider telemetry');
          samples.push(scoreRealTailoringSample({
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
      console.log(`REAL_TAILORING_CASE_JSON=${JSON.stringify({ caseId: c.id, samples })}`);
    });
  }

  it('prints aggregate and per-case measurements', () => {
    expect(byCase).toHaveLength(cases.length);
    const result = aggregateRealTailoringCampaign(model, byCase);
    expect(result.sampleCount).toBe(cases.length * REAL_TAILORING_RUNS_PER_CASE);
    console.log(`\nREAL_TAILORING_RESULT_JSON=${JSON.stringify(result)}\n`);
    console.log(formatRealTailoringCampaign(result));
  });
});