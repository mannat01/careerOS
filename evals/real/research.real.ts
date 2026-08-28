/** Track B Slice 6 — paid, on-demand real-model research campaign (non-CI). */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { LlmResearchSynthesizerAgent } from '@careeros/cie-research';
import { describe, expect, it } from 'vitest';
import { loadResearchSynthesisCases } from '../src/datasets.js';
import { createRealCampaignRuntime } from '../src/real-campaign-runtime.js';
import {
  REAL_ONLY_RESEARCH_CASES,
  REAL_RESEARCH_RUNS_PER_CASE,
  aggregateRealResearchCampaign,
  formatRealResearchCampaign,
  scoreRealResearchSample,
  type RealResearchCase,
  type RealResearchSample,
} from '../src/real-research-harness.js';

const { costUsdAt, gateway, model, provider, selectedProvider } = createRealCampaignRuntime();
const agent = new LlmResearchSynthesizerAgent(gateway);
const cases: RealResearchCase[] = [...loadResearchSynthesisCases(), ...REAL_ONLY_RESEARCH_CASES];
const byCase: Array<{ c: RealResearchCase; samples: RealResearchSample[] }> = [];

/**
 * Optional transient checkpoint resume. A provider transport failure must not
 * force already-paid samples to be purchased again. The checkpoint remains
 * outside git; every resumed sample is re-emitted into the new run log.
 */
function loadCheckpoint(): Map<string, RealResearchSample[]> {
  const path = resolve(process.cwd(), '.real-research-resume.log');
  const byId = new Map<string, RealResearchSample[]>();
  if (!existsSync(path)) return byId;
  const caseIds = new Set(cases.map((c) => c.id));
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('REAL_RESEARCH_SAMPLE_JSON=')) continue;
    const parsed = JSON.parse(line.slice(line.indexOf('=') + 1)) as {
      caseId: string;
      sample: RealResearchSample;
    };
    if (!caseIds.has(parsed.caseId)) throw new Error(`Checkpoint has unknown case ${parsed.caseId}`);
    if (parsed.sample.run < 1 || parsed.sample.run > REAL_RESEARCH_RUNS_PER_CASE) {
      throw new Error(`Checkpoint has invalid run ${parsed.sample.run} for ${parsed.caseId}`);
    }
    const samples = byId.get(parsed.caseId) ?? [];
    if (!samples.some((sample) => sample.run === parsed.sample.run)) samples.push(parsed.sample);
    byId.set(parsed.caseId, samples);
  }
  return byId;
}

const checkpoint = loadCheckpoint();

describe.sequential(`Track B Slice 6 — real ${selectedProvider} research campaign (non-CI)`, () => {
  let campaignFailure: Error | undefined;
  for (const c of cases) {
    it(`${c.id} ×${REAL_RESEARCH_RUNS_PER_CASE}`, async () => {
      if (campaignFailure) throw new Error(`Campaign stopped after provider failure: ${campaignFailure.message}`);
      const samples: RealResearchSample[] = [...(checkpoint.get(c.id) ?? [])]
        .sort((a, b) => a.run - b.run);
      for (const sample of samples) {
        console.log(`REAL_RESEARCH_SAMPLE_JSON=${JSON.stringify({ caseId: c.id, sample, resumed: true })}`);
      }
      try {
        for (let run = 1; run <= REAL_RESEARCH_RUNS_PER_CASE; run += 1) {
          if (samples.some((sample) => sample.run === run)) continue;
          const completionIndex = provider.completions.length;
          const started = performance.now();
          const produced = await agent.synthesize(c.input);
          const latencyMs = performance.now() - started;
          const completion = provider.completions[completionIndex];
          if (produced.status === 'ok') {
            expect(completion, 'provider completion recording').toBeDefined();
            if (!completion) throw new Error('Missing provider telemetry');
          } else {
            expect(completion, 'insufficient_data must not call the model').toBeUndefined();
          }
          const sample = scoreRealResearchSample({
            c,
            run,
            rawText: completion?.text ?? JSON.stringify(produced),
            produced,
            response: completion
              ? { usage: completion.usage, costUsd: costUsdAt(completionIndex) }
              : { usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0 },
            latencyMs,
          });
          samples.push(sample);
          console.log(`REAL_RESEARCH_SAMPLE_JSON=${JSON.stringify({ caseId: c.id, sample })}`);
        }
      } catch (error) {
        campaignFailure = error instanceof Error ? error : new Error(String(error));
        throw campaignFailure;
      }
      byCase.push({ c, samples });
      console.log(`REAL_RESEARCH_CASE_JSON=${JSON.stringify({ caseId: c.id, samples })}`);
    });
  }

  it('prints aggregate and per-case measurements', () => {
    expect(byCase).toHaveLength(cases.length);
    const result = aggregateRealResearchCampaign(model, byCase);
    expect(result.sampleCount).toBe(cases.length * REAL_RESEARCH_RUNS_PER_CASE);
    expect(result.fabricationLeaks, 'final-output fabrication leaks').toBe(0);
    console.log(`\nREAL_RESEARCH_RESULT_JSON=${JSON.stringify(result)}\n`);
    console.log(formatRealResearchCampaign(result));
  });
});