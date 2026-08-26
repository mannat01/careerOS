import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createLlmGateway,
  createLlmProviderFromEnv,
  OmniRouteProvider,
  type CostMeter,
  type LlmProvider,
  type LlmProviderEnv,
  type LlmResponse,
} from '@careeros/llm-gateway';

const ANTHROPIC_PRICING: Record<string, { inputUsdPerMTok: number; outputUsdPerMTok: number }> = {
  'claude-3-5-haiku-latest': { inputUsdPerMTok: 0.8, outputUsdPerMTok: 4 },
  'claude-haiku-4-5': { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
  'claude-haiku-4-5-20251001': { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
};

export interface RecordedCompletion {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** Records raw model output without bypassing or changing the real provider. */
export class RecordingLlmProvider implements LlmProvider {
  readonly vendor: string;
  readonly completions: RecordedCompletion[] = [];

  constructor(private readonly inner: LlmProvider) {
    this.vendor = inner.vendor;
  }

  async complete(req: Parameters<LlmProvider['complete']>[0]): Promise<RecordedCompletion> {
    const completion = await this.inner.complete(req);
    this.completions.push(completion);
    return completion;
  }
}

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

export interface RealCampaignRuntime {
  selectedProvider: 'anthropic' | 'omniroute';
  model: string;
  provider: RecordingLlmProvider;
  gateway: ReturnType<typeof createLlmGateway>;
  costUsdAt: (callIndex: number) => number;
}

/** Shared paid-campaign composition. It is imported only by paid real suites. */
export function createRealCampaignRuntime(): RealCampaignRuntime {
  const campaignEnv = loadCampaignEnv();
  const selected = campaignEnv.LLM_PROVIDER?.trim();
  if (selected !== 'anthropic' && selected !== 'omniroute') {
    throw new Error("eval:real requires LLM_PROVIDER='anthropic' or LLM_PROVIDER='omniroute' in the repository .env");
  }

  const modelFromEnv = selected === 'omniroute'
    ? campaignEnv.OMNIROUTE_MODEL?.trim()
    : campaignEnv.LLM_CHEAP_MODEL?.trim();
  const model = modelFromEnv && !modelFromEnv.startsWith('#') ? modelFromEnv : 'claude-haiku-4-5';
  if (selected === 'anthropic' && ANTHROPIC_PRICING[model] === undefined) {
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

  const selectedProvider = selected === 'omniroute'
    ? new OmniRouteProvider({
        baseUrl: campaignEnv.OMNIROUTE_BASE_URL ?? '',
        apiKey: campaignEnv.OMNIROUTE_API_KEY ?? '',
        model,
        // Frontier strategic-reasoning completions (apply/wait/negotiate) on a
        // reasoning model can run for several minutes. This is a paid, non-CI
        // measurement path; allow a slow-but-valid call to finish rather than
        // mis-reporting model latency as a provider failure.
      }, { fetch: recordingFetch, timeoutMs: 600_000 })
    : createLlmProviderFromEnv(campaignEnv);
  const provider = new RecordingLlmProvider(selectedProvider);
  const costEvents: Parameters<CostMeter>[0][] = [];
  const gateway = createLlmGateway({
    provider,
    modelsByTier: { cheap: model, frontier: model },
    // OmniRoute reports authoritative routed cost on each response. A zero rate
    // keeps the gateway event shape intact; the campaign uses the response header.
    pricing: selected === 'omniroute'
      ? { [model]: { inputUsdPerMTok: 0, outputUsdPerMTok: 0 } }
      : ANTHROPIC_PRICING,
    onCost: (event) => void costEvents.push(event),
  });

  return {
    selectedProvider: selected,
    model,
    provider,
    gateway,
    costUsdAt(callIndex): number {
      const costUsd = selected === 'omniroute'
        ? omniRouteResponseCostsUsd[callIndex]
        : costEvents[callIndex]?.costUsd;
      if (costUsd === undefined) throw new Error('Missing provider cost telemetry');
      return costUsd;
    },
  };
}

export type RealCampaignResponse = Pick<LlmResponse, 'usage' | 'costUsd'>;