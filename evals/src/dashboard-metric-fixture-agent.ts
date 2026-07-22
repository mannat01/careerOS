/**
 * Fixture-backed Dashboard-Metric-Composer Agent — wraps the REAL agent
 * (@careeros/cie-metrics `LlmDashboardMetricComposerAgent`) with a
 * FakeLlmProvider so the full pipeline (prompt → parse → DETERMINISTIC
 * guardrail `composeDashboardMetrics`) runs; only the network LLM call is
 * faked. Turning the M08 metrics golden gate from RED (stub) to GREEN
 * without editing the frozen golden set.
 *
 * The FakeLlmProvider ACTIVELY attempts the four canonical dm-09..12 sins on
 * every request — the golden set contains four adversarial cases (dm-09..12)
 * and the fixture agent must fail each sin at the deterministic guardrail:
 *   - dm-09: CHEERLEAD on a flat/declining trend ("surging", "skyrocketing",
 *     "crushing it") even when the deterministic trend is FLAT.
 *   - dm-10: ASSERT a value with no supporting evidence — pack a fabricated
 *     numeric score into the explanation text.
 *   - dm-11: CITE a nonexistent evidence ref via the explanation ("per
 *     evidence dm-nonexistent-ref").
 *   - dm-12: LINK a nonexistent plan action via the explanation ("plan action
 *     '30d-fake-action' will move it").
 * The real guardrail defeats each: value/trend/status/refs/action are computed
 * deterministically from the input; every LLM explanation draft is validated
 * and substituted with a fallback if it cheerleads, invents evidence, or
 * misses the "why it matters + how to move it" arms.
 *
 * The evals `DashboardMetricAgent` returns `DashboardMetric[]`; the real
 * agent returns `DashboardMetricComposition` ({ metrics, modelVersion }). We
 * unwrap so the harness contract matches without leaking model-version
 * metadata into the golden assertions.
 */
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import {
  LlmDashboardMetricComposerAgent,
  ALL_METRIC_KEYS,
} from '@careeros/cie-metrics';
import type {
  DashboardMetric,
  DashboardMetricAgent,
  DashboardMetricInput,
} from './types.js';

/**
 * The FABRICATED explanations the fake frontier model emits on every call —
 * attempts every dm-09..12 sin in one payload. Every entry also lacks the
 * "why it matters / how to move it" arms so the shape gate trips too, and
 * the deterministic fallback substitutes a grounded explanation.
 */
function fabricatedExplanations(): { explanations: Record<string, string> } {
  return {
    explanations: Object.fromEntries(
      ALL_METRIC_KEYS.map((k) => [
        k,
        'Your ' +
          k +
          ' is surging — skyrocketing to 99/100 (crushing it)! Per evidence dm-nonexistent-ref, the plan action "30d-fake-action" will keep it on fire.',
      ]),
    ),
  };
}

/**
 * Construct the evals-shaped `DashboardMetricAgent` that:
 *   1. Structurally maps the harness `DashboardMetricInput` (evals types) to
 *      the metrics package's `MetricComposerInput` (they are field-compatible).
 *   2. Delegates to the REAL composer behind a FakeLlmProvider that attempts
 *      the four dm-09..12 sins on every response.
 *   3. Unwraps the returned `DashboardMetricComposition` to the array the
 *      harness expects.
 */
export function createDashboardMetricComposerFixtureAgent(): DashboardMetricAgent {
  const fakeProvider = new FakeLlmProvider(() => {
    const json = JSON.stringify(fabricatedExplanations());
    return { text: json, usage: { inputTokens: 100, outputTokens: json.length } };
  });

  const gateway = createLlmGateway({
    provider: fakeProvider,
    modelsByTier: { cheap: 'fixture-cheap', frontier: 'fixture-frontier' },
    pricing: {},
  });

  const real = new LlmDashboardMetricComposerAgent(gateway);

  return {
    async compose(input: DashboardMetricInput): Promise<DashboardMetric[]> {
      // Structural pass-through: the metrics package types are a subset of
      // the evals types (same field names + shapes). Cast is safe.
      const composition = await real.compose(input);
      // Unwrap { metrics, modelVersion } → the array the harness expects.
      return composition.metrics;
    },
  };
}