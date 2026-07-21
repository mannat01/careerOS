/**
 * Dashboard-Metric-Composer skill-agent — Career State Model + graph +
 * research findings + active plan actions + application/outcome history →
 * a set of grounded, calibrated dashboard metrics (one per A1.6 key), with a
 * model version stamp.
 *
 * Discipline (stricter than the other skill-agents):
 *   1. Build system + user prompt (prompt.ts) — the LLM is told it may ONLY
 *      draft the explanation TEXT; values, trends, statuses, evidence refs, and
 *      linked plan actions are decided upstream.
 *   2. Call the llm-gateway FRONTIER tier — the composer is reasoning, not
 *      a cheap classify (CLAUDE.md §3.6).
 *   3. Parse JSON with Zod (io.ts `rawMetricExplanationsSchema`) — fail-closed
 *      on garbage.
 *   4. DETERMINISTIC guardrail (io.ts `composeDashboardMetrics`) — the model's
 *      explanations are ADVISORY ONLY. The value/trend/status/refs/action are
 *      computed from real evidence and the LLM's draft is validated and
 *      substituted with a deterministic fallback on any violation. This step —
 *      not the prompt — makes the metrics golden gate green and defeats each
 *      dm-09..12 sin (cheerleading on flat/declining, no-evidence value, bad
 *      ref, bad action).
 *
 * The agent NEVER imports @careeros/db: it receives its inputs (state model,
 * graph, findings, plan actions, application history, allowed-refs allow-list)
 * from the caller through app-side ports.
 */
import type { LlmGateway } from '@careeros/llm-gateway';
import {
  METRIC_COMPOSER_SYSTEM_PROMPT,
  buildMetricComposerUserPrompt,
  type MetricExplanationBrief,
} from './prompt.js';
import { composeDashboardMetrics, rawMetricExplanationsSchema } from './io.js';
import {
  ALL_METRIC_KEYS,
  type DashboardMetricComposition,
  type MetricComposerInput,
} from './model.js';

/** Structurally matches evals/src/types.ts `DashboardMetricAgent` (kept decoupled). */
export interface DashboardMetricAgent {
  compose(input: MetricComposerInput): Promise<DashboardMetricComposition>;
}

const EMPTY_EXPLANATIONS = { explanations: {} as Record<string, string> };

export class LlmDashboardMetricComposerAgent implements DashboardMetricAgent {
  constructor(private readonly gateway: LlmGateway) {}

  async compose(input: MetricComposerInput): Promise<DashboardMetricComposition> {
    const explanations = await this.propose(input);
    // The explanations are ADVISORY ONLY: the guardrail recomputes each metric
    // from real evidence and validates the draft, substituting a deterministic
    // fallback when the draft cheerleads, invents evidence, or is empty.
    return composeDashboardMetrics(explanations, input);
  }

  /** Call the frontier LLM and parse (fail-closed). Explanations are advisory. */
  private async propose(_input: MetricComposerInput) {
    // Build one brief per A1.6 key so the model sees which metric to draft for.
    const briefs: MetricExplanationBrief[] = ALL_METRIC_KEYS.map((key) => ({
      key,
      status: 'ok',
      trend: 'flat',
      evidenceHooks: [],
    }));

    const messages = [
      { role: 'system' as const, content: METRIC_COMPOSER_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: buildMetricComposerUserPrompt(briefs),
      },
    ];

    const response = await this.gateway.complete({
      tier: 'frontier',
      messages,
      maxTokens: 4096,
      temperature: 0,
    });

    const parsed = rawMetricExplanationsSchema.safeParse(safeJsonParse(response.text));
    return parsed.success ? parsed.data : EMPTY_EXPLANATIONS;
  }
}

/** JSON.parse that returns null instead of throwing (fail-closed boundary). */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}