/**
 * Dashboard Metric Composer prompt — instructs the FRONTIER tier to DRAFT the
 * plain-language EXPLANATION TEXT for each dashboard metric. The prompt makes
 * the sharp rule explicit: the LLM does NOT propose values, trends, statuses,
 * evidence refs, or linked plan actions — those are computed deterministically
 * from real evidence upstream and passed in. The LLM's only job is to write a
 * short "why it matters + how to move it" paragraph per metric, using ONLY the
 * evidence hooks + linked plan action title we hand it. Anything else the model
 * emits is DISCARDED by the deterministic guardrail in io.ts.
 *
 * Even so, a real frontier model (and our probe FakeLlmProvider) will still
 * occasionally: cheerlead on a flat trend, hallucinate an evidence hook, cite a
 * nonexistent action, invent a value, or emit an empty explanation. The
 * guardrail (`groundDashboardMetrics`) validates the drafted text and
 * substitutes a deterministic fallback when the draft lies.
 */

import type { DashboardMetricKey, MetricTrend } from './model.js';

export const METRIC_COMPOSER_PROMPT_VERSION = '1.0.0';

export const METRIC_COMPOSER_SYSTEM_PROMPT = `You are the dashboard metric EXPLANATION writer for a career-intelligence system. You do NOT compute numbers. You do NOT decide trends. You do NOT choose which evidence a metric cites. You do NOT choose which plan action a metric links to. All of that is decided deterministically upstream from real evidence and passed to you as read-only context.

Your only job: for each metric provided, DRAFT ONE explanation paragraph that:
- states plainly WHY IT MATTERS to this user (the "why it matters" arm), and
- states plainly HOW TO MOVE IT via the linked plan action (the "how to move it" arm),
- uses the evidence hooks provided VERBATIM (no invented statistics, no invented outcomes),
- has a TONE consistent with the computed trend: RISING may be encouraging; FLAT is neutral/steady; DECLINING is honest/direct — NEVER upbeat.

HARD RULES (the system enforces these deterministically; do not attempt to evade them):
- NEVER emit a number as the whole explanation. NEVER emit an empty string.
- NEVER use cheerleading language ("surging", "skyrocketing", "crushing it", "on fire", "blowing away", "accelerating", "rapidly improving", "explosive") on a FLAT or DECLINING trend.
- NEVER invent an evidence hook. Only use hooks provided in context.
- NEVER invent a plan action title. Only reference the plan action title provided.
- For status='insufficient_data' metrics: acknowledge the data is INSUFFICIENT / NOT ENOUGH; suggest what evidence would help. Do NOT invent a value.

Return ONLY a JSON object: { "explanations": { "<metricKey>": "<paragraph>" } }. No markdown, no commentary.`;

export interface MetricExplanationBrief {
  key: DashboardMetricKey;
  status: 'ok' | 'insufficient_data';
  value?: number;
  trend: MetricTrend;
  evidenceHooks: string[];
  linkedPlanActionTitle?: string;
  /**
   * The specific human phrase the value is anchored on (e.g. "3 of 5 target
   * artifacts published"). The guardrail requires the LLM's draft — or the
   * deterministic fallback — to mention at least one such hook.
   */
  anchorPhrase?: string;
}

export function buildMetricComposerUserPrompt(briefs: MetricExplanationBrief[]): string {
  const lines: string[] = [];
  for (const b of briefs) {
    const value = b.status === 'ok' && b.value !== undefined ? `${b.value}/100` : 'insufficient data';
    const hooks = b.evidenceHooks.length ? b.evidenceHooks.map((h) => `  - ${h}`).join('\n') : '  (none)';
    const linked = b.linkedPlanActionTitle ? `  linked plan action: "${b.linkedPlanActionTitle}"` : '  linked plan action: (none)';
    lines.push(
      `METRIC ${b.key}\n  status: ${b.status}\n  value: ${value}\n  trend: ${b.trend}\n  evidence hooks:\n${hooks}\n${linked}`,
    );
  }
  return `DRAFT the explanation paragraph for each metric below. Use the evidence hooks verbatim; keep tone consistent with the trend.\n\n${lines.join('\n\n')}`;
}