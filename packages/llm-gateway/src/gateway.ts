import { randomBytes } from 'node:crypto';
import {
  llmRequestSchema,
  type CostMeter,
  type LlmProvider,
  type LlmRequestInput,
  type LlmResponse,
  type ModelPricing,
  type ModelTier,
} from './types.js';

export interface LlmGatewayOptions {
  provider: LlmProvider;
  /** tier → concrete model id (from packages/config env: LLM_CHEAP_MODEL / LLM_FRONTIER_MODEL). */
  modelsByTier: Record<ModelTier, string>;
  /** model id → pricing; unknown models meter at 0 with a warning flag left to callers. */
  pricing: Record<string, ModelPricing>;
  onCost?: CostMeter;
  traceIdFactory?: () => string;
}

export interface LlmGateway {
  complete(req: LlmRequestInput): Promise<LlmResponse>;
}

export function computeCostUsd(
  pricing: ModelPricing | undefined,
  usage: { inputTokens: number; outputTokens: number },
): number {
  if (pricing === undefined) return 0;
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputUsdPerMTok +
    (usage.outputTokens / 1_000_000) * pricing.outputUsdPerMTok
  );
}

/**
 * The single path for every LLM call in the product (coding-standards.md §3):
 * validates the request, routes tier → model, attaches a trace id, and meters cost.
 */
export function createLlmGateway(opts: LlmGatewayOptions): LlmGateway {
  const traceIdFactory = opts.traceIdFactory ?? ((): string => randomBytes(16).toString('hex'));

  return {
    async complete(input: LlmRequestInput): Promise<LlmResponse> {
      const req = llmRequestSchema.parse(input); // boundary validation, fail loud
      const model = opts.modelsByTier[req.tier];
      const traceId = req.traceId ?? traceIdFactory();

      const { text, usage } = await opts.provider.complete({
        model,
        messages: req.messages,
        maxTokens: req.maxTokens,
        temperature: req.temperature,
        traceId,
      });

      const costUsd = computeCostUsd(opts.pricing[model], usage);
      await opts.onCost?.({
        userId: req.userId ?? null,
        tier: req.tier,
        model,
        usage,
        costUsd,
        traceId,
      });

      return { text, model, tier: req.tier, usage, traceId, costUsd };
    },
  };
}
