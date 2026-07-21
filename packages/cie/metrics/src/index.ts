/**
 * @careeros/cie-metrics — the Dashboard-Metric-Composer skill-agent + service (M08).
 * One skill-agent per folder: agent.ts / prompt.ts / io.ts / agent.eval.ts
 * (coding-standards §7). Never imports @careeros/db — reaches state model +
 * graph + findings + plan actions + application history + sanctioned refs
 * only through app-side ports.
 */
export {
  METRIC_COMPOSER_MODEL_VERSION,
  ALL_METRIC_KEYS,
  INSUFFICIENT_DATA_CONFIDENCE,
  INSUFFICIENT_DATA_CONFIDENCE_MAX,
  type DashboardMetric,
  type DashboardMetricComposition,
  type DashboardMetricKey,
  type MetricApplicationOutcome,
  type MetricComposerInput,
  type MetricGraphNode,
  type MetricPlanAction,
  type MetricResearchFinding,
  type MetricStateDimension,
  type MetricTrend,
} from './model.js';

export {
  METRIC_COMPOSER_SYSTEM_PROMPT,
  METRIC_COMPOSER_PROMPT_VERSION,
  buildMetricComposerUserPrompt,
  type MetricExplanationBrief,
} from './prompt.js';

export {
  rawMetricExplanationsSchema,
  rawExplanationsSchema,
  composeDashboardMetrics,
  rawProposalToMetrics,
  type RawMetricExplanations,
} from './io.js';

export {
  LlmDashboardMetricComposerAgent,
  type DashboardMetricAgent,
} from './agent.js';

export {
  DashboardMetricComposerService,
  type DashboardMetricComposerServiceDeps,
  type MetricStatePort,
  type MetricGraphPort,
  type MetricFindingPort,
  type MetricPlanPort,
  type MetricHistoryPort,
  type MetricEvidencePort,
} from './service.js';