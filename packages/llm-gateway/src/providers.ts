import { z } from 'zod';
import type { LlmMessage, LlmProvider, LlmUsage } from './types.js';

/** Deterministic fake for tests — no network, records every call it receives. */
export class FakeLlmProvider implements LlmProvider {
  readonly vendor = 'fake';
  readonly calls: Array<{ model: string; messages: LlmMessage[]; maxTokens: number; temperature: number; traceId: string }> = [];

  constructor(
    private readonly respond: (req: { model: string; messages: LlmMessage[] }) => {
      text: string;
      usage: LlmUsage;
    } = () => ({ text: 'ok', usage: { inputTokens: 100, outputTokens: 20 } }),
  ) {}

  complete(req: {
    model: string;
    messages: LlmMessage[];
    maxTokens: number;
    temperature: number;
    traceId: string;
  }): Promise<{ text: string; usage: LlmUsage }> {
    this.calls.push(req);
    return Promise.resolve(this.respond(req));
  }
}

const anthropicResponseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});

const anthropicErrorSchema = z.object({
  error: z.object({ type: z.string().optional(), message: z.string().optional() }).optional(),
}).passthrough();

export interface AnthropicProviderOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  apiVersion?: string;
}

/** Real Anthropic Messages API adapter (ADR-001 launch vendor). */
export class AnthropicProvider implements LlmProvider {
  readonly vendor = 'anthropic';
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly apiVersion: string;

  constructor(private readonly apiKey: string, options: AnthropicProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? 'https://api.anthropic.com';
    this.apiVersion = options.apiVersion ?? '2023-06-01';
  }

  async complete(req: {
    model: string;
    messages: LlmMessage[];
    maxTokens: number;
    temperature: number;
    traceId: string;
  }): Promise<{ text: string; usage: LlmUsage }> {
    if (this.apiKey.trim().length === 0) {
      throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
    }

    const system = req.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
    const messages = req.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: message.content }));

    const response = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
      },
      body: JSON.stringify({
        model: req.model,
        ...(system.length > 0 ? { system } : {}),
        messages,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
      }),
    });

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsedError = anthropicErrorSchema.safeParse(body);
      const detail = parsedError.success
        ? parsedError.data.error?.message ?? parsedError.data.error?.type
        : undefined;
      const requestId = response.headers.get('request-id') ?? response.headers.get('x-request-id');
      throw new Error(
        `Anthropic Messages API failed (${response.status}${requestId ? `, request ${requestId}` : ''})${detail ? `: ${detail}` : ''}`,
      );
    }

    const parsed = anthropicResponseSchema.safeParse(body);
    if (!parsed.success) throw new Error('Anthropic Messages API returned an invalid response shape');
    const text = parsed.data.content
      .filter((block) => block.type === 'text' && block.text !== undefined)
      .map((block) => block.text ?? '')
      .join('');
    if (text.length === 0) throw new Error('Anthropic Messages API returned no text content');

    return {
      text,
      usage: {
        inputTokens: parsed.data.usage.input_tokens,
        outputTokens: parsed.data.usage.output_tokens,
      },
    };
  }
}

export type LlmProviderName = 'anthropic' | 'fake';
export interface LlmProviderEnv {
  LLM_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
}

/**
 * Gateway-owned provider selection for on-demand callers. It defaults to fake
 * so tests/local app paths never incur network or spend unless explicitly opted in.
 */
export function createLlmProviderFromEnv(
  env: LlmProviderEnv = {},
): LlmProvider {
  const selected = env.LLM_PROVIDER?.trim() || 'fake';
  if (selected === 'fake') return new FakeLlmProvider();
  if (selected === 'anthropic') return new AnthropicProvider(env.ANTHROPIC_API_KEY ?? '');
  throw new Error(`Unsupported LLM_PROVIDER '${selected}'; expected 'anthropic' or 'fake'`);
}
