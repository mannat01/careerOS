import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { LlmExtractionAgent } from '@careeros/agents';
import {
  createLlmGateway,
  createLlmProviderFromEnv,
  type CostMeter,
  type LlmProviderEnv,
  type LlmResponse,
} from '@careeros/llm-gateway';
import { describe, expect, it } from 'vitest';
import { loadExtractionCases } from '../src/datasets.js';
import {
  aggregateRealExtractionCampaign,
  formatRealExtractionCampaign,
  RecordingLlmProvider,
  REAL_RUNS_PER_CASE,
  scoreRealExtractionSample,
  type RealExtractionSample,
} from '../src/real-extraction-harness.js';

const PRICING: Record<string, { inputUsdPerMTok: number; outputUsdPerMTok: number }> = {
  'claude-3-5-haiku-latest': { inputUsdPerMTok: 0.8, outputUsdPerMTok: 4 },
  'claude-haiku-4-5': { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
  'claude-haiku-4-5-20251001': { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
};

function loadCampaignEnv(): LlmProviderEnv & { LLM_CHEAP_MODEL?: string } {
  const envPath = resolve(process.cwd(), '../.env');
  const text = readFileSync(envPath, 'utf8');
  const env: LlmProviderEnv & { LLM_CHEAP_MODEL?: string } = {};
  const anthropicKeys: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match?.[1]) continue;
    const raw = match[2] ?? '';
    if (raw.startsWith('#')) continue;
    const value = raw.replace(/^(['"])(.*)\1$/, '$2').trim();
    if (match[1] === 'ANTHROPIC_API_KEY' && value.length > 0) anthropicKeys.push(value);
    if (match[1] === 'LLM_CHEAP_MODEL') env.LLM_CHEAP_MODEL = value;
  }
  const fullFormKeys = anthropicKeys.filter((value) => value.startsWith('sk-ant-') && value.length >= 80);
  if (fullFormKeys.length !== 1) {
    throw new Error(
      `Expected exactly one full-form ANTHROPIC_API_KEY in ${envPath}; found ${fullFormKeys.length} ` +
        `across ${anthropicKeys.length} non-empty assignments`,
    );
  }
  env.ANTHROPIC_API_KEY = fullFormKeys[0];
  return { ...env, LLM_PROVIDER: 'anthropic' };
}

const campaignEnv = loadCampaignEnv();

const modelFromEnv = campaignEnv.LLM_CHEAP_MODEL?.trim();
const model = modelFromEnv && !modelFromEnv.startsWith('#') ? modelFromEnv : 'claude-haiku-4-5';
if (PRICING[model] === undefined) {
  throw new Error(`No real-eval pricing configured for LLM_CHEAP_MODEL='${model}'; refusing to report a false zero cost`);
}
const key = campaignEnv.ANTHROPIC_API_KEY?.trim();
if (!key) throw new Error('ANTHROPIC_API_KEY must be set in the repository .env before eval:real');

const provider = new RecordingLlmProvider(createLlmProviderFromEnv(campaignEnv));
const costEvents: Parameters<CostMeter>[0][] = [];
const gateway = createLlmGateway({
  provider,
  modelsByTier: { cheap: model, frontier: model },
  pricing: PRICING,
  onCost: (event) => void costEvents.push(event),
});
const agent = new LlmExtractionAgent(gateway);
const cases = loadExtractionCases();
const byCase: Array<{ c: (typeof cases)[number]; samples: RealExtractionSample[] }> = [];

describe.sequential('Track B Slice 1 — real Anthropic extraction campaign (non-CI)', () => {
  let campaignFailure: Error | undefined;
  for (const c of cases) {
    it(`${c.id} ×${REAL_RUNS_PER_CASE}`, async () => {
      if (campaignFailure) throw new Error(`Campaign stopped after provider failure: ${campaignFailure.message}`);
      const samples: RealExtractionSample[] = [];
      try {
        for (let run = 1; run <= REAL_RUNS_PER_CASE; run += 1) {
          const completionIndex = provider.completions.length;
          const costIndex = costEvents.length;
          const started = performance.now();
          const producedDetailed = await agent.extractDetailed(c.resumeText);
          const latencyMs = performance.now() - started;
          const completion = provider.completions[completionIndex];
          const cost = costEvents[costIndex];
          expect(completion, 'provider completion recording').toBeDefined();
          expect(cost, 'gateway cost event').toBeDefined();
          if (!completion || !cost) throw new Error('Missing provider telemetry');

          const produced = producedDetailed.map((entity) => ({
            kind: entity.kind,
            name: entity.name,
            ...(entity.detail !== undefined ? { detail: entity.detail } : {}),
            provenance: entity.provenance,
          }));
          const response: Pick<LlmResponse, 'usage' | 'costUsd'> = { usage: completion.usage, costUsd: cost.costUsd };
          samples.push(scoreRealExtractionSample({
            c, run, rawText: completion.text, produced, response, latencyMs,
          }));
        }
      } catch (error) {
        campaignFailure = error instanceof Error ? error : new Error(String(error));
        throw campaignFailure;
      }
      byCase.push({ c, samples });
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