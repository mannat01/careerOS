import { z } from 'zod';
import { LlmGatewayError } from './errors.js';
import type { LlmMessage, LlmProvider, LlmUsage } from './types.js';

const omniRouteResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().min(1) }),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
  }).optional(),
});

export interface OmniRouteProviderOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/** OpenAI-compatible OmniRoute chat-completions adapter. */
export class OmniRouteProvider implements LlmProvider {
  readonly vendor = 'omniroute';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(
    config: { baseUrl: string; apiKey: string; model: string },
    options: OmniRouteProviderOptions = {},
  ) {
    this.baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
    this.apiKey = config.apiKey.trim();
    this.model = config.model.trim();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;

    const missing = [
      this.baseUrl.length === 0 ? 'OMNIROUTE_BASE_URL' : undefined,
      this.apiKey.length === 0 ? 'OMNIROUTE_API_KEY' : undefined,
      this.model.length === 0 ? 'OMNIROUTE_MODEL' : undefined,
    ].filter((name): name is string => name !== undefined);
    if (missing.length > 0) {
      throw new Error(
        `Invalid OmniRoute configuration — ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required when LLM_PROVIDER=omniroute`,
      );
    }
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Invalid OmniRoute configuration — timeoutMs must be a positive number');
    }
  }

  async complete(req: {
    model: string;
    messages: LlmMessage[];
    maxTokens: number;
    temperature: number;
    traceId: string;
  }): Promise<{ text: string; usage: LlmUsage }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: this.model, messages: req.messages }),
        signal: controller.signal,
      });

      const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? undefined;
      if (!response.ok) {
        throw new LlmGatewayError(
          `OmniRoute chat completions failed with HTTP ${response.status}${requestId ? ` (request ${requestId})` : ''}`,
          'http_error',
          { status: response.status, ...(requestId ? { requestId } : {}) },
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        if (controller.signal.aborted) throw this.timeoutError();
        throw new LlmGatewayError(
          'OmniRoute chat completions returned malformed JSON',
          'invalid_response',
          requestId ? { requestId } : {},
        );
      }
      const parsed = omniRouteResponseSchema.safeParse(body);
      if (!parsed.success || parsed.data.choices[0] === undefined) {
        throw new LlmGatewayError(
          'OmniRoute chat completions returned an invalid response shape',
          'invalid_response',
          requestId ? { requestId } : {},
        );
      }

      const usage = parsed.data.usage;
      return {
        text: parsed.data.choices[0].message.content,
        usage: usage
          ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
          : { inputTokens: 0, outputTokens: 0 },
      };
    } catch (error) {
      if (error instanceof LlmGatewayError) throw error;
      if (controller.signal.aborted) throw this.timeoutError();
      throw new LlmGatewayError('OmniRoute chat completions request failed', 'transport_error');
    } finally {
      clearTimeout(timeout);
    }
  }

  private timeoutError(): LlmGatewayError {
    return new LlmGatewayError(
      `OmniRoute chat completions request timed out after ${this.timeoutMs}ms`,
      'timeout',
    );
  }
}