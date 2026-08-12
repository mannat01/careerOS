import type { Env } from '@careeros/config';
import {
  AnthropicProvider,
  FakeLlmProvider,
  OmniRouteProvider,
  type LlmProvider,
} from '@careeros/llm-gateway';

/**
 * LLM provider selection seam — mirrors the AUTH_PROVIDER dev/clerk pattern in
 * bootstrap.ts. The concrete provider is chosen from env HERE and nowhere else;
 * everything downstream receives the `LlmProvider` interface via the gateway.
 *
 * WHY THIS EXISTS: local development and the dev-only shape-verification
 * surfaces need the API to boot and serve real, correctly-SHAPED responses
 * without network access or an ANTHROPIC_API_KEY. The alternative people reach
 * for — hand-editing bootstrap.ts to drop in an inline stub — is worse in every
 * way: it isn't type-checked against `LlmProvider`, it bypasses the real
 * serialization/grounding path, it can't be tested, and it risks being
 * committed. So the seam is explicit, typed, and guarded.
 *
 * OmniRoute selection validates all required settings here, at composition
 * time. It never falls back to fake when explicitly selected.
 *
 * IMPORTANT — the fake is NOT a content stub. It is the real, deterministic
 * `FakeLlmProvider` from @careeros/llm-gateway, wired through the SAME gateway,
 * so every downstream agent still runs its real Zod parse + deterministic
 * guardrail pipeline over the response. The default fake response is not valid
 * agent JSON, so each agent's fail-closed branch yields its canonical EMPTY
 * shape (e.g. the state model's canonical dimension frame with no values).
 * That is the honest outcome: real response shapes, absent content — never
 * fabricated content dressed up as inference.
 */
export function buildLlmProvider(
  env: Pick<
    Env,
    | 'LLM_PROVIDER'
    | 'ANTHROPIC_API_KEY'
    | 'OMNIROUTE_BASE_URL'
    | 'OMNIROUTE_API_KEY'
    | 'OMNIROUTE_MODEL'
  >,
): LlmProvider {
  const selected = env.LLM_PROVIDER;

  if (selected === 'fake') return new FakeLlmProvider();
  if (selected === 'anthropic') return new AnthropicProvider(env.ANTHROPIC_API_KEY ?? '');
  return new OmniRouteProvider({
    baseUrl: env.OMNIROUTE_BASE_URL ?? '',
    apiKey: env.OMNIROUTE_API_KEY ?? '',
    model: env.OMNIROUTE_MODEL ?? '',
  });
}
