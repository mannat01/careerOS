import { describe, expect, it } from 'vitest';
import {
  AnthropicProvider,
  computeCostUsd,
  createLlmProviderFromEnv,
  createLlmGateway,
  FakeLlmProvider,
  type CostMeter,
} from '../src/index.js';

const MODELS = { cheap: 'claude-3-5-haiku-latest', frontier: 'claude-sonnet-4-5' } as const;
const PRICING = {
  'claude-3-5-haiku-latest': { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
  'claude-sonnet-4-5': { inputUsdPerMTok: 3, outputUsdPerMTok: 15 },
};

describe('llm-gateway (ADR-001: single vendor, tiered routing)', () => {
  it('routes tier=cheap and tier=frontier to their configured models', async () => {
    const provider = new FakeLlmProvider();
    const gateway = createLlmGateway({ provider, modelsByTier: MODELS, pricing: PRICING });

    await gateway.complete({ tier: 'cheap', messages: [{ role: 'user', content: 'classify' }] });
    await gateway.complete({ tier: 'frontier', messages: [{ role: 'user', content: 'reason' }] });

    expect(provider.calls[0]?.model).toBe('claude-3-5-haiku-latest');
    expect(provider.calls[1]?.model).toBe('claude-sonnet-4-5');
  });

  it('rejects an unknown tier at the boundary', async () => {
    const gateway = createLlmGateway({ provider: new FakeLlmProvider(), modelsByTier: MODELS, pricing: PRICING });
    await expect(
      gateway.complete({ tier: 'ultra' as unknown as 'cheap', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow();
  });

  it('attaches a trace id when absent and propagates a provided one', async () => {
    const provider = new FakeLlmProvider();
    const gateway = createLlmGateway({
      provider, modelsByTier: MODELS, pricing: PRICING, traceIdFactory: () => 'generated-trace',
    });
    const r1 = await gateway.complete({ tier: 'cheap', messages: [{ role: 'user', content: 'x' }] });
    expect(r1.traceId).toBe('generated-trace');
    expect(provider.calls[0]?.traceId).toBe('generated-trace');

    const r2 = await gateway.complete({
      tier: 'cheap', messages: [{ role: 'user', content: 'x' }], traceId: 'caller-trace',
    });
    expect(r2.traceId).toBe('caller-trace');
    expect(provider.calls[1]?.traceId).toBe('caller-trace');
  });

  it('invokes the cost-metering hook with tokens, model, tier, user and cost', async () => {
    const events: Parameters<CostMeter>[0][] = [];
    const provider = new FakeLlmProvider(() => ({ text: 'ok', usage: { inputTokens: 1_000_000, outputTokens: 200_000 } }));
    const gateway = createLlmGateway({
      provider, modelsByTier: MODELS, pricing: PRICING, onCost: (e) => void events.push(e),
    });
    const res = await gateway.complete({
      tier: 'frontier', userId: 'u-1', messages: [{ role: 'user', content: 'plan my career' }],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: 'u-1', tier: 'frontier', model: 'claude-sonnet-4-5' });
    // 1M in @ $3/MTok + 0.2M out @ $15/MTok = $6
    expect(events[0]?.costUsd).toBeCloseTo(6, 10);
    expect(res.costUsd).toBeCloseTo(6, 10);
  });

  it('computeCostUsd meters unknown models at 0 (never throws mid-call)', () => {
    expect(computeCostUsd(undefined, { inputTokens: 10, outputTokens: 10 })).toBe(0);
  });

  it('maps gateway messages to Anthropic Messages and returns text + usage', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = (url, init) => {
      const requestUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      calls.push({ url: requestUrl, init });
      return Promise.resolve(new Response(JSON.stringify({
        content: [{ type: 'text', text: '{"entities":[]}' }],
        usage: { input_tokens: 42, output_tokens: 7 },
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    };
    const provider = new AnthropicProvider('sk-test', { fetch: fetchMock });

    const result = await provider.complete({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'system', content: 'system rules' }, { role: 'user', content: 'extract' }],
      maxTokens: 100,
      temperature: 0,
      traceId: 'trace-1',
    });

    expect(result).toEqual({ text: '{"entities":[]}', usage: { inputTokens: 42, outputTokens: 7 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    const rawBody = calls[0]?.init?.body;
    expect(typeof rawBody).toBe('string');
    const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}') as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'claude-haiku-4-5', system: 'system rules', max_tokens: 100, temperature: 0,
      messages: [{ role: 'user', content: 'extract' }],
    });
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('fails loud with status and request id while preserving the API key', async () => {
    const fetchMock: typeof fetch = () => Promise.resolve(new Response(
      JSON.stringify({ error: { type: 'authentication_error', message: 'bad key' } }),
      { status: 401, headers: { 'request-id': 'req-123' } },
    ));
    const provider = new AnthropicProvider('sk-secret', { fetch: fetchMock });
    const request = provider.complete({
      model: 'claude-haiku-4-5', messages: [{ role: 'user', content: 'x' }],
      maxTokens: 10, temperature: 0, traceId: 'trace-1',
    });
    await expect(request).rejects.toThrow(/401, request req-123.*bad key/);
    await expect(request).rejects.not.toThrow(/sk-secret/);
  });

  it('selects providers by env and defaults to the fake', () => {
    expect(createLlmProviderFromEnv({}).vendor).toBe('fake');
    expect(createLlmProviderFromEnv({ LLM_PROVIDER: 'fake' }).vendor).toBe('fake');
    expect(createLlmProviderFromEnv({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' }).vendor).toBe('anthropic');
    expect(() => createLlmProviderFromEnv({ LLM_PROVIDER: 'other' })).toThrow(/Unsupported LLM_PROVIDER/);
  });
});
