import { describe, expect, it } from 'vitest';
import { AnthropicProvider, FakeLlmProvider, OmniRouteProvider } from '@careeros/llm-gateway';
import { buildLlmProvider } from '../src/common/llm/llm-provider-factory.js';

/**
 * The LLM provider seam is a SAFETY boundary, not a convenience. These tests
 * pin the properties that matter: fake remains deterministic, and explicitly
 * selected real providers never quietly fall back when misconfigured.
 */
describe('buildLlmProvider', () => {
  const base = { ANTHROPIC_API_KEY: 'sk-test' } as const;

  it('anthropic composes the existing real vendor adapter', () => {
    const provider = buildLlmProvider({
      ...base,
      LLM_PROVIDER: 'anthropic',
    });
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.vendor).toBe('anthropic');
  });

  it('development + fake composes the deterministic gateway fake (no network, no key)', () => {
    const provider = buildLlmProvider({
      LLM_PROVIDER: 'fake',
      ANTHROPIC_API_KEY: undefined,
    });
    expect(provider).toBeInstanceOf(FakeLlmProvider);
    expect(provider.vendor).toBe('fake');
  });

  it('composes anthropic when explicitly selected', () => {
    const provider = buildLlmProvider({
      ...base,
      LLM_PROVIDER: 'anthropic',
    });
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it('the fake is NOT a content stub — it returns a non-agent-JSON response so agents fail closed', async () => {
    const provider = buildLlmProvider({
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

  it('composes OmniRoute when explicitly selected with all required env', () => {
    const provider = buildLlmProvider({
      LLM_PROVIDER: 'omniroute',
      ANTHROPIC_API_KEY: undefined,
      OMNIROUTE_BASE_URL: 'http://localhost:20128/v1',
      OMNIROUTE_API_KEY: 'omni-test',
      OMNIROUTE_MODEL: 'gpt-5.6-sol',
    });
    expect(provider).toBeInstanceOf(OmniRouteProvider);
    expect(provider).toMatchObject({ vendor: 'omniroute', model: 'gpt-5.6-sol' });
  });

  it.each(['OMNIROUTE_BASE_URL', 'OMNIROUTE_API_KEY', 'OMNIROUTE_MODEL'] as const)(
    'fails fast instead of falling back when %s is missing',
    (missing) => {
      const config = {
        LLM_PROVIDER: 'omniroute' as const,
        ANTHROPIC_API_KEY: undefined,
        OMNIROUTE_BASE_URL: 'http://localhost:20128/v1',
        OMNIROUTE_API_KEY: 'omni-test',
        OMNIROUTE_MODEL: 'gpt-5.6-sol',
      };
      config[missing] = undefined as never;
      expect(() => buildLlmProvider(config)).toThrow(new RegExp(`${missing}.*required when LLM_PROVIDER=omniroute`));
    },
  );
});