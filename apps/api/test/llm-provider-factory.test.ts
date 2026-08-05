import { describe, expect, it } from 'vitest';
import { AnthropicProvider, FakeLlmProvider } from '@careeros/llm-gateway';
import { buildLlmProvider } from '../src/common/llm/llm-provider-factory.js';

/**
 * The LLM provider seam is a SAFETY boundary, not a convenience. These tests
 * pin the one property that matters: production can never be served by
 * anything but the real vendor, and the failure is a loud throw at boot rather
 * than a quiet substitution.
 */
describe('buildLlmProvider', () => {
  const base = { ANTHROPIC_API_KEY: 'sk-test' } as const;

  it('fails CLOSED: production + fake provider throws at composition time', () => {
    expect(() =>
      buildLlmProvider({ ...base, NODE_ENV: 'production', LLM_PROVIDER: 'fake' }),
    ).toThrow(/not permitted when NODE_ENV=production/);
  });

  it('production + anthropic composes the real vendor adapter', () => {
    const provider = buildLlmProvider({
      ...base,
      NODE_ENV: 'production',
      LLM_PROVIDER: 'anthropic',
    });
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.vendor).toBe('anthropic');
  });

  it('development + fake composes the deterministic gateway fake (no network, no key)', () => {
    const provider = buildLlmProvider({
      NODE_ENV: 'development',
      LLM_PROVIDER: 'fake',
      ANTHROPIC_API_KEY: undefined,
    });
    expect(provider).toBeInstanceOf(FakeLlmProvider);
    expect(provider.vendor).toBe('fake');
  });

  it('defaults to anthropic in development when LLM_PROVIDER is not set to fake', () => {
    const provider = buildLlmProvider({
      ...base,
      NODE_ENV: 'development',
      LLM_PROVIDER: 'anthropic',
    });
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it('the fake is NOT a content stub — it returns a non-agent-JSON response so agents fail closed', async () => {
    const provider = buildLlmProvider({
      NODE_ENV: 'development',
      LLM_PROVIDER: 'fake',
      ANTHROPIC_API_KEY: undefined,
    });
    const res = await provider.complete({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
      temperature: 0,
      traceId: 't',
    });
    // Deliberately NOT parseable as any agent contract: downstream Zod parses
    // reject it and each agent yields its canonical EMPTY shape. Real shapes,
    // absent content — never fabricated content dressed up as inference.
    expect(() => {
      JSON.parse(res.text);
    }).toThrow();
  });
});