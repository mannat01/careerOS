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

// STUB(M01): stands in for the real Anthropic Messages API adapter (ADR-001 launch
// vendor). Wire @anthropic-ai/sdk here when network + ANTHROPIC_API_KEY exist; it must
// map messages, pass max_tokens/temperature, and return token usage from the response.
export class AnthropicProvider implements LlmProvider {
  readonly vendor = 'anthropic';

  constructor(private readonly _apiKey: string) {}

  complete(): Promise<{ text: string; usage: LlmUsage }> {
    return Promise.reject(
      new Error('STUB(M01): AnthropicProvider requires network access; use FakeLlmProvider in tests'),
    );
  }
}
