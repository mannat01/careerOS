import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { LlmExtractionAgent } from '@careeros/agents';
import {
  createLlmGateway,
  createLlmProviderFromEnv,
  OmniRouteProvider,
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
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match?.[1]) continue;
    const raw = match[2] ?? '';
    if (raw.startsWith('#')) continue;
    const value = raw.replace(/^(['"])(.*)\1$/, '$2').trim();
    const key = match[1];
    if (
      key === 'LLM_PROVIDER' ||
      key === 'ANTHROPIC_API_KEY' ||
      key === 'OMNIROUTE_BASE_URL' ||
      key === 'OMNIROUTE_API_KEY' ||
      key === 'OMNIROUTE_MODEL'
    ) {
      env[key] = value;
    }
    if (key === 'LLM_CHEAP_MODEL') env.LLM_CHEAP_MODEL = value;
  }
  return env;
}

const campaignEnv = loadCampaignEnv();
const selectedProvider = campaignEnv.LLM_PROVIDER?.trim();
if (selectedProvider !== 'anthropic' && selectedProvider !== 'omniroute') {
  throw new Error("eval:real requires LLM_PROVIDER='anthropic' or LLM_PROVIDER='omniroute' in the repository .env");
}

const modelFromEnv = selectedProvider === 'omniroute'
  ? campaignEnv.OMNIROUTE_MODEL?.trim()
  : campaignEnv.LLM_CHEAP_MODEL?.trim();
const model = modelFromEnv && !modelFromEnv.startsWith('#') ? modelFromEnv : 'claude-haiku-4-5';
if (selectedProvider === 'anthropic' && PRICING[model] === undefined) {
  throw new Error(`No real-eval pricing configured for LLM_CHEAP_MODEL='${model}'; refusing to report a false zero cost`);
}

const omniRouteResponseCostsUsd: number[] = [];
const originalFetch = globalThis.fetch;
const recordingFetch: typeof globalThis.fetch = async (input, init): Promise<Response> => {
    const response = await originalFetch(input, init);
    const costHeader = response.headers.get('x-omniroute-response-cost');
    const costUsd = costHeader === null ? Number.NaN : Number(costHeader);
    if (!Number.isFinite(costUsd) || costUsd < 0) {
      throw new Error('OmniRoute completion omitted a valid non-negative X-OmniRoute-Response-Cost header');
    }
    omniRouteResponseCostsUsd.push(costUsd);
    return response;
};
const selectedLlmProvider = selectedProvider === 'omniroute'
  ? new OmniRouteProvider({
      baseUrl: campaignEnv.OMNIROUTE_BASE_URL ?? '',
      apiKey: campaignEnv.OMNIROUTE_API_KEY ?? '',
      model,
    }, { fetch: recordingFetch, timeoutMs: 180_000 })
  : createLlmProviderFromEnv(campaignEnv);
const provider = new RecordingLlmProvider(selectedLlmProvider);
const costEvents: Parameters<CostMeter>[0][] = [];
const gateway = createLlmGateway({
  provider,
  modelsByTier: { cheap: model, frontier: model },
  // OmniRoute reports authoritative routed cost on each response. A zero rate
  // keeps the gateway event shape intact; the sample uses the captured header.
  pricing: selectedProvider === 'omniroute'
    ? { [model]: { inputUsdPerMTok: 0, outputUsdPerMTok: 0 } }
    : PRICING,
  onCost: (event) => void costEvents.push(event),
});
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
          const costIndex = costEvents.length;
          const omniRouteCostIndex = omniRouteResponseCostsUsd.length;
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
          const costUsd = selectedProvider === 'omniroute'
            ? omniRouteResponseCostsUsd[omniRouteCostIndex]
            : cost.costUsd;
          expect(costUsd, 'provider cost recording').toBeDefined();
          if (costUsd === undefined) throw new Error('Missing provider cost telemetry');
          const response: Pick<LlmResponse, 'usage' | 'costUsd'> = { usage: completion.usage, costUsd };
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