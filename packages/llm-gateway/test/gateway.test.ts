import { describe, expect, it } from 'vitest';
import {
  AnthropicProvider,
  computeCostUsd,
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

  it('AnthropicProvider is an offline stub that fails loud, not silent', async () => {
    const p = new AnthropicProvider('sk-test');
    await expect(p.complete()).rejects.toThrow(/STUB\(M01\)/);
  });
});
