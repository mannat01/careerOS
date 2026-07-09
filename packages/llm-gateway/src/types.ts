import { z } from 'zod';

/**
 * Provider-abstraction per ADR-001: vendor-neutral interface, single vendor
 * (Anthropic) at launch, two tiers. Cheap = extract/score/rank/classify/scan;
 * frontier = tailoring/strategic reasoning/planning/synthesis/coaching.
 */

export const modelTierSchema = z.enum(['cheap', 'frontier']);
export type ModelTier = z.infer<typeof modelTierSchema>;

export const llmMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});
export type LlmMessage = z.infer<typeof llmMessageSchema>;

export const llmRequestSchema = z.object({
  tier: modelTierSchema,
  messages: z.array(llmMessageSchema).min(1),
  maxTokens: z.number().int().positive().default(1024),
  temperature: z.number().min(0).max(1).default(0),
  userId: z.string().optional(),
  traceId: z.string().optional(),
});
export type LlmRequest = z.infer<typeof llmRequestSchema>;
export type LlmRequestInput = z.input<typeof llmRequestSchema>;

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResponse {
  text: string;
  model: string;
  tier: ModelTier;
  usage: LlmUsage;
  traceId: string;
  costUsd: number;
}

/** What a concrete vendor adapter must implement. */
export interface LlmProvider {
  readonly vendor: string;
  complete(req: {
    model: string;
    messages: LlmMessage[];
    maxTokens: number;
    temperature: number;
    traceId: string;
  }): Promise<{ text: string; usage: LlmUsage }>;
}

/** Cost-metering hook: called once per completed call (per-user budgets build on this). */
export type CostMeter = (event: {
  userId: string | null;
  tier: ModelTier;
  model: string;
  usage: LlmUsage;
  costUsd: number;
  traceId: string;
}) => void | Promise<void>;

export interface ModelPricing {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}
