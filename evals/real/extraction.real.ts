import { performance } from 'node:perf_hooks';
import { LlmExtractionAgent } from '@careeros/agents';
import { describe, expect, it } from 'vitest';
import { loadExtractionCases } from '../src/datasets.js';
import {
  aggregateRealExtractionCampaign,
  formatRealExtractionCampaign,
  REAL_RUNS_PER_CASE,
  scoreRealExtractionSample,
  type RealExtractionSample,
} from '../src/real-extraction-harness.js';
import { createRealCampaignRuntime } from '../src/real-campaign-runtime.js';

const { costUsdAt, gateway, model, provider, selectedProvider } = createRealCampaignRuntime();
const agent = new LlmExtractionAgent(gateway);
const cases = loadExtractionCases();
const byCase: Array<{ c: (typeof cases)[number]; samples: RealExtractionSample[] }> = [];

describe.sequential(`Track B Slice 1 — real ${selectedProvider} extraction campaign (non-CI)`, () => {
  let campaignFailure: Error | undefined;
  for (const c of cases) {
    it(`${c.id} ×${REAL_RUNS_PER_CASE}`, async () => {
      if (campaignFailure) throw new Error(`Campaign stopped after provider failure: ${campaignFailure.message}`);
      const samples: RealExtractionSample[] = [];
      try {
        for (let run = 1; run <= REAL_RUNS_PER_CASE; run += 1) {
          const completionIndex = provider.completions.length;
          const started = performance.now();
          const producedDetailed = await agent.extractDetailed(c.resumeText);
          const latencyMs = performance.now() - started;
          const completion = provider.completions[completionIndex];
          expect(completion, 'provider completion recording').toBeDefined();
          if (!completion) throw new Error('Missing provider telemetry');

          const produced = producedDetailed.map((entity) => ({
            kind: entity.kind,
            name: entity.name,
            ...(entity.detail !== undefined ? { detail: entity.detail } : {}),
            provenance: entity.provenance,
          }));
          const costUsd = costUsdAt(completionIndex);
          const response = { usage: completion.usage, costUsd };
          samples.push(scoreRealExtractionSample({
            c, run, rawText: completion.text, produced, response, latencyMs,
          }));
        }
      } catch (error) {
        campaignFailure = error instanceof Error ? error : new Error(String(error));
        throw campaignFailure;
      }
      byCase.push({ c, samples });
      console.log(`REAL_EXTRACTION_CASE_JSON=${JSON.stringify({ caseId: c.id, samples })}`);
    });
  }

  it('prints aggregate and per-case measurements', () => {
    expect(byCase).toHaveLength(cases.length);
    const result = aggregateRealExtractionCampaign(model, byCase);
    expect(result.sampleCount).toBe(cases.length * REAL_RUNS_PER_CASE);
    console.log(`\nREAL_EXTRACTION_RESULT_JSON=${JSON.stringify(result)}\n`);
    console.log(formatRealExtractionCampaign(result));
  });
});