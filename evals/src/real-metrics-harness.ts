/** Track B Slice 10 — real-model dashboard-metrics measurement harness. */
import { createHash } from 'node:crypto';
import {
  ALL_METRIC_KEYS,
  composeDashboardMetrics,
  rawMetricExplanationsSchema,
  type DashboardMetric,
  type DashboardMetricComposition,
  type RawMetricExplanations,
} from '@careeros/cie-metrics';
import { scoreDashboardMetricCase } from './dashboard-harness.js';
import type { DashboardMetricCase } from './types.js';
import type { RealCampaignResponse } from './real-campaign-runtime.js';

export const REAL_METRICS_RUNS_PER_CASE = 3;

export interface RealMetricCase extends DashboardMetricCase {
  focusKey: DashboardMetric['key'];
  thinInsufficientData?: boolean;
}

/** Completes explicit coverage of all ten metric keys without changing CI goldens. */
export const REAL_ONLY_METRIC_CASES: RealMetricCase[] = [
  {
    id: 'dm-r1-strategic-recommendations',
    description:
      'A sanctioned market finding and a real active action ground strategic_recommendations.',
    focusKey: 'strategic_recommendations',
    input: {
      stateModel: [{
        dimension: 'strategic_recommendations',
        values: ['Prioritize Kubernetes evidence for staff-level applications'],
        confidence: 0.8,
        evidenceRefs: ['rf-k8s-priority'],
      }],
      graph: [],
      findings: [{
        id: 'rf-k8s-priority',
        domain: 'hiring',
        claim: 'Staff backend postings increasingly request production Kubernetes evidence.',
        sourceId: 'licensed-hiring-index-2026',
        strength: 'strong',
      }],
      activePlanActions: [{
        id: '30d-k8s-proof',
        title: 'Publish a Kubernetes reliability case study',
        goalId: 'g-staff-role',
      }],
      applicationHistory: [],
      allowedEvidenceRefs: ['rf-k8s-priority', '30d-k8s-proof'],
    },
    expected: {
      metrics: [{
        key: 'strategic_recommendations',
        status: 'ok',
        trend: 'flat',
        valueBand: { min: 75, max: 85 },
        confidenceBand: { min: 0.8, max: 0.9 },
        mustCiteEvidenceRefs: ['rf-k8s-priority', '30d-k8s-proof'],
        mustLinkPlanActionId: '30d-k8s-proof',
        explanationMustMentionAny: ['strategic recommendations', 'kubernetes', 'case study'],
      }],
    },
  },
];

const FOCUS_KEYS_BY_FROZEN_CASE: Record<string, DashboardMetric['key']> = {
  'dm-01-career-momentum-rising': 'career_momentum',
  'dm-02-interview-readiness-rising': 'interview_readiness',
  'dm-03-skill-momentum-flat': 'skill_momentum',
  'dm-04-market-positioning-with-research': 'market_positioning',
  'dm-05-salary-trajectory-rising': 'salary_trajectory',
  'dm-06-opportunity-quality-declining': 'opportunity_quality',
  'dm-07-recruiter-engagement-flat': 'recruiter_engagement',
  'dm-08-insufficient-data-networking': 'networking_strength',
  'dm-09-adv-cheerleader-flat-trend': 'portfolio_completeness',
  'dm-10-adv-fabricated-no-evidence': 'career_momentum',
  'dm-11-adv-nonexistent-evidence-ref': 'career_momentum',
  'dm-12-adv-nonexistent-plan-action': 'skill_momentum',
};

export function toRealMetricCase(c: DashboardMetricCase): RealMetricCase {
  const focusKey = FOCUS_KEYS_BY_FROZEN_CASE[c.id];
  if (!focusKey) throw new Error(`Missing real-metrics focus key for ${c.id}`);
  return {
    ...c,
    focusKey,
    thinInsufficientData:
      c.id === 'dm-08-insufficient-data-networking' ||
      c.id === 'dm-10-adv-fabricated-no-evidence',
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseRaw(text: string): { parseValid: boolean; proposal: RawMetricExplanations } {
  try {
    const parsed = rawMetricExplanationsSchema.safeParse(JSON.parse(text) as unknown);
    return parsed.success
      ? { parseValid: true, proposal: parsed.data }
      : { parseValid: false, proposal: { explanations: {} } };
  } catch {
    return { parseValid: false, proposal: { explanations: {} } };
  }
}

function structuralMetric(metric: DashboardMetric): Omit<DashboardMetric, 'explanation'> {
  const { explanation: _explanation, ...structural } = metric;
  return structural;
}

function compositionSignature(composition: DashboardMetricComposition): string {
  return digest(JSON.stringify(composition));
}

function rawNumbers(text: string): string[] {
  return text.match(/\b\d+(?:\.\d+)?%?\b/g) ?? [];
}

function supportedNumbers(c: RealMetricCase, metric: DashboardMetric): Set<string> {
  const source = JSON.stringify(c.input);
  const allowed = new Set(rawNumbers(source).map((value) => value.replace(/%$/, '')));
  if (metric.value !== undefined) allowed.add(String(metric.value));
  return allowed;
}

function explanationLeakReasons(
  c: RealMetricCase,
  metric: DashboardMetric,
  fallbackMetric: DashboardMetric,
): string[] {
  const reasons: string[] = [];
  const text = metric.explanation.trim();
  const lower = text.toLowerCase();
  if (text.length === 0 || /^-?\d+(?:\.\d+)?$/.test(text)) reasons.push('missing-explanation');
  for (const forbidden of c.forbidden ?? []) {
    if (lower.includes(forbidden.toLowerCase())) reasons.push(`forbidden:${forbidden}`);
  }
  if (metric.status === 'insufficient_data' && !/(insufficient|not enough)/i.test(text)) {
    reasons.push('thin-explanation-claims-sufficiency');
  }
  const allowedNumbers = supportedNumbers(c, metric);
  for (const number of rawNumbers(text)) {
    if (!allowedNumbers.has(number.replace(/%$/, ''))) reasons.push(`unsupported-number:${number}`);
  }
  const urls = text.match(/https?:\/\/[^\s)]+/gi) ?? [];
  const source = JSON.stringify(c.input).toLowerCase();
  for (const url of urls) if (!source.includes(url.toLowerCase())) reasons.push(`unsupported-url:${url}`);

  // Production's deterministic fallback is grounded by construction. A model
  // explanation that survives must at minimum preserve one real anchor. This is
  // independent of exact prose and catches generic unanchored output.
  if (text !== fallbackMetric.explanation) {
    const anchors = [
      ...c.input.stateModel.flatMap((dimension) => dimension.values),
      ...c.input.graph.map((node) => node.label),
      ...c.input.findings.flatMap((finding) => [finding.claim, finding.domain]),
      ...c.input.activePlanActions.map((action) => action.title),
      ...c.input.applicationHistory.flatMap((outcome) => [outcome.stage, outcome.note ?? '']),
      metric.key.replace(/_/g, ' '),
    ].map((value) => value.trim().toLowerCase()).filter((value) => value.length >= 4);
    if (!anchors.some((anchor) => lower.includes(anchor))) reasons.push('unanchored-model-explanation');
  }
  return [...new Set(reasons)];
}

export interface RealMetricSample {
  run: number;
  focusKey: DashboardMetric['key'];
  parseValid: boolean;
  goldenPassed: boolean;
  finalMetricCount: number;
  groundedMetricCount: number;
  fabricationLeaks: string[];
  insufficientDataCorrect: boolean;
  confidenceHandlingCorrect: boolean;
  explanationSubstitutions: number;
  rawMissingExplanations: number;
  rawUnsupportedNumbers: number;
  guardrailCaught: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  outputSignature: string;
  rawOutputSignature: string;
}

export function scoreRealMetricSample(input: {
  c: RealMetricCase;
  run: number;
  rawText: string;
  output: DashboardMetricComposition;
  response: RealCampaignResponse;
  latencyMs: number;
}): RealMetricSample {
  const { c, output } = input;
  const parsed = parseRaw(input.rawText);
  const fallback = composeDashboardMetrics({ explanations: {} }, c.input);
  const fallbackByKey = new Map(fallback.metrics.map((metric) => [metric.key, metric]));
  const fabricationLeaks: string[] = [];
  let groundedMetricCount = 0;
  let confidenceHandlingCorrect = output.metrics.length === ALL_METRIC_KEYS.length;
  let explanationSubstitutions = 0;
  let rawMissingExplanations = 0;
  let rawUnsupportedNumbers = 0;

  if (output.modelVersion !== fallback.modelVersion) fabricationLeaks.push('model-version-mismatch');
  if (output.metrics.length !== ALL_METRIC_KEYS.length) fabricationLeaks.push('metric-count-mismatch');

  for (const key of ALL_METRIC_KEYS) {
    const metric = output.metrics.find((candidate) => candidate.key === key);
    const expected = fallbackByKey.get(key);
    if (!metric || !expected) {
      fabricationLeaks.push(`missing-metric:${key}`);
      continue;
    }
    let grounded = true;
    if (JSON.stringify(structuralMetric(metric)) !== JSON.stringify(structuralMetric(expected))) {
      fabricationLeaks.push(`structural-recompute-mismatch:${key}`);
      grounded = false;
    }
    const explanationLeaks = explanationLeakReasons(c, metric, expected);
    for (const reason of explanationLeaks) fabricationLeaks.push(`${reason}:${key}`);
    if (explanationLeaks.length > 0) grounded = false;
    if (grounded) groundedMetricCount += 1;

    const rawExplanation = parsed.proposal.explanations[key]?.trim();
    if (!rawExplanation) rawMissingExplanations += 1;
    if ((rawExplanation ?? '') !== metric.explanation) explanationSubstitutions += 1;
    const allowedNumbers = supportedNumbers(c, metric);
    for (const number of rawNumbers(rawExplanation ?? '')) {
      if (!allowedNumbers.has(number.replace(/%$/, ''))) rawUnsupportedNumbers += 1;
    }
    if (metric.status === 'insufficient_data') {
      confidenceHandlingCorrect &&= metric.confidence <= 0.5 && metric.value === undefined;
    } else {
      confidenceHandlingCorrect &&= metric.confidence >= 0 && metric.confidence <= 1;
    }
  }

  const focus = output.metrics.find((metric) => metric.key === c.focusKey);
  const insufficientDataCorrect = !c.thinInsufficientData || (
    focus?.status === 'insufficient_data' &&
    focus.value === undefined &&
    focus.confidence <= 0.5 &&
    focus.evidenceRefs.length === 0 &&
    focus.linkedPlanActionId === undefined
  );
  if (!insufficientDataCorrect) fabricationLeaks.push(`thin-handling:${c.focusKey}`);

  const golden = scoreDashboardMetricCase(c, output.metrics);
  const uniqueLeaks = [...new Set(fabricationLeaks)];
  return {
    run: input.run,
    focusKey: c.focusKey,
    parseValid: parsed.parseValid,
    goldenPassed: golden.passed,
    finalMetricCount: output.metrics.length,
    groundedMetricCount,
    fabricationLeaks: uniqueLeaks,
    insufficientDataCorrect,
    confidenceHandlingCorrect,
    explanationSubstitutions,
    rawMissingExplanations,
    rawUnsupportedNumbers,
    guardrailCaught: explanationSubstitutions,
    latencyMs: input.latencyMs,
    inputTokens: input.response.usage.inputTokens,
    outputTokens: input.response.usage.outputTokens,
    costUsd: input.response.costUsd,
    outputSignature: compositionSignature(output),
    rawOutputSignature: digest(input.rawText),
  };
}

export interface RealMetricCaseResult {
  caseId: string;
  focusKey: DashboardMetric['key'];
  adversarial: boolean;
  thin: boolean;
  samples: RealMetricSample[];
  goldenPasses: number;
  fabricationLeaks: number;
  groundedMetrics: number;
  metricCount: number;
  insufficientDataCorrect: number;
  guardrailCaught: number;
  samplesWithGuardrailCaught: number;
  meanLatencyMs: number;
  latencyStdDevMs: number;
  meanInputTokens: number;
  meanOutputTokens: number;
  totalCostUsd: number;
  distinctFinalOutputs: number;
  distinctRawOutputs: number;
}

export interface RealMetricCampaignResult {
  model: string;
  caseCount: number;
  sampleCount: number;
  runsPerCase: number;
  paidCompletionCount: number;
  coveredKeys: DashboardMetric['key'][];
  fabricationLeaks: number;
  groundingFidelity: number;
  accuracyRate: number;
  thinCorrect: number;
  thinSampleCount: number;
  confidenceSemantics: 'evidence-strength';
  confidenceHandlingRate: number;
  ece: null;
  parseValidSamples: number;
  guardrailCaught: number;
  samplesWithGuardrailCaught: number;
  guardrailAffectedRate: number;
  rawMissingExplanations: number;
  rawUnsupportedNumbers: number;
  meanLatencyMs: number;
  latencyStdDevMs: number;
  p95LatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  inputTokensStdDev: number;
  outputTokensStdDev: number;
  totalCostUsd: number;
  meanCostUsd: number;
  costStdDevUsd: number;
  casesWithVariableFinalOutput: number;
  casesWithVariableRawOutput: number;
  cases: RealMetricCaseResult[];
  verdict: 'GREEN' | 'YELLOW' | 'RED';
  verdictReasons: string[];
}

export function aggregateRealMetricCampaign(
  model: string,
  byCase: Array<{ c: RealMetricCase; samples: RealMetricSample[] }>,
): RealMetricCampaignResult {
  const all = byCase.flatMap(({ samples }) => samples);
  const cases: RealMetricCaseResult[] = byCase.map(({ c, samples }) => ({
    caseId: c.id,
    focusKey: c.focusKey,
    adversarial: c.adversarial === true,
    thin: c.thinInsufficientData === true,
    samples,
    goldenPasses: samples.filter((sample) => sample.goldenPassed).length,
    fabricationLeaks: samples.reduce((sum, sample) => sum + sample.fabricationLeaks.length, 0),
    groundedMetrics: samples.reduce((sum, sample) => sum + sample.groundedMetricCount, 0),
    metricCount: samples.reduce((sum, sample) => sum + sample.finalMetricCount, 0),
    insufficientDataCorrect: samples.filter((sample) => sample.insufficientDataCorrect).length,
    guardrailCaught: samples.reduce((sum, sample) => sum + sample.guardrailCaught, 0),
    samplesWithGuardrailCaught: samples.filter((sample) => sample.guardrailCaught > 0).length,
    meanLatencyMs: mean(samples.map((sample) => sample.latencyMs)),
    latencyStdDevMs: standardDeviation(samples.map((sample) => sample.latencyMs)),
    meanInputTokens: mean(samples.map((sample) => sample.inputTokens)),
    meanOutputTokens: mean(samples.map((sample) => sample.outputTokens)),
    totalCostUsd: samples.reduce((sum, sample) => sum + sample.costUsd, 0),
    distinctFinalOutputs: new Set(samples.map((sample) => sample.outputSignature)).size,
    distinctRawOutputs: new Set(samples.map((sample) => sample.rawOutputSignature)).size,
  }));
  const fabricationLeaks = all.reduce((sum, sample) => sum + sample.fabricationLeaks.length, 0);
  const thinSamples = byCase.filter(({ c }) => c.thinInsufficientData).flatMap(({ samples }) => samples);
  const groundedMetrics = all.reduce((sum, sample) => sum + sample.groundedMetricCount, 0);
  const metricCount = all.reduce((sum, sample) => sum + sample.finalMetricCount, 0);
  const samplesWithGuardrailCaught = all.filter((sample) => sample.guardrailCaught > 0).length;
  const guardrailAffectedRate = all.length === 0 ? 0 : samplesWithGuardrailCaught / all.length;
  const accuracyRate = all.length === 0 ? 0 : all.filter((sample) => sample.goldenPassed).length / all.length;
  const confidenceHandlingRate = all.length === 0
    ? 0
    : all.filter((sample) => sample.confidenceHandlingCorrect).length / all.length;
  const thinCorrect = thinSamples.filter((sample) => sample.insufficientDataCorrect).length;
  const verdictReasons: string[] = [];
  let verdict: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
  if (fabricationLeaks > 0) {
    verdict = 'RED';
    verdictReasons.push('one or more final fabrication/grounding leaks');
  } else if (thinCorrect !== thinSamples.length) {
    verdict = 'RED';
    verdictReasons.push('thin evidence produced a fabricated or overconfident metric');
  } else {
    if (accuracyRate < 1) verdictReasons.push('one or more final outputs missed the frozen property gate');
    if (confidenceHandlingRate < 1) verdictReasons.push('one or more confidence handling checks failed');
    if (guardrailAffectedRate > 0.25) {
      verdictReasons.push('guardrail frequently replaced raw model explanations (>25% of paid samples)');
    }
    if (verdictReasons.length > 0) verdict = 'YELLOW';
  }
  const latencies = all.map((sample) => sample.latencyMs);
  const inputTokens = all.map((sample) => sample.inputTokens);
  const outputTokens = all.map((sample) => sample.outputTokens);
  const costs = all.map((sample) => sample.costUsd);
  return {
    model,
    caseCount: byCase.length,
    sampleCount: all.length,
    runsPerCase: REAL_METRICS_RUNS_PER_CASE,
    paidCompletionCount: all.length,
    coveredKeys: [...new Set(byCase.map(({ c }) => c.focusKey))],
    fabricationLeaks,
    groundingFidelity: metricCount === 0 ? 0 : groundedMetrics / metricCount,
    accuracyRate,
    thinCorrect,
    thinSampleCount: thinSamples.length,
    confidenceSemantics: 'evidence-strength',
    confidenceHandlingRate,
    ece: null,
    parseValidSamples: all.filter((sample) => sample.parseValid).length,
    guardrailCaught: all.reduce((sum, sample) => sum + sample.guardrailCaught, 0),
    samplesWithGuardrailCaught,
    guardrailAffectedRate,
    rawMissingExplanations: all.reduce((sum, sample) => sum + sample.rawMissingExplanations, 0),
    rawUnsupportedNumbers: all.reduce((sum, sample) => sum + sample.rawUnsupportedNumbers, 0),
    meanLatencyMs: mean(latencies),
    latencyStdDevMs: standardDeviation(latencies),
    p95LatencyMs: percentile95(latencies),
    totalInputTokens: inputTokens.reduce((sum, value) => sum + value, 0),
    totalOutputTokens: outputTokens.reduce((sum, value) => sum + value, 0),
    inputTokensStdDev: standardDeviation(inputTokens),
    outputTokensStdDev: standardDeviation(outputTokens),
    totalCostUsd: costs.reduce((sum, value) => sum + value, 0),
    meanCostUsd: mean(costs),
    costStdDevUsd: standardDeviation(costs),
    casesWithVariableFinalOutput: cases.filter((result) => result.distinctFinalOutputs > 1).length,
    casesWithVariableRawOutput: cases.filter((result) => result.distinctRawOutputs > 1).length,
    cases,
    verdict,
    verdictReasons,
  };
}

export function formatRealMetricCampaign(result: RealMetricCampaignResult): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const rows = result.cases.map((c) => {
    const kind = c.thin ? 'thin' : c.adversarial ? 'adv' : 'standard';
    return `| ${c.caseId} | ${c.focusKey} | ${kind} | ${c.goldenPasses}/${c.samples.length} | ${c.groundedMetrics}/${c.metricCount} | ${c.fabricationLeaks} | ${c.insufficientDataCorrect}/${c.samples.length} | ${c.guardrailCaught} (${c.samplesWithGuardrailCaught}/${c.samples.length}) | ${Math.round(c.meanLatencyMs)} ± ${Math.round(c.latencyStdDevMs)} | ${Math.round(c.meanInputTokens)} / ${Math.round(c.meanOutputTokens)} | $${c.totalCostUsd.toFixed(6)} | ${c.distinctRawOutputs}/${c.samples.length} |`;
  });
  return [
    `Model: ${result.model}`,
    `Samples: ${result.sampleCount} (${result.caseCount} cases × ${result.runsPerCase}); paid completions ${result.paidCompletionCount}`,
    `Metric-key coverage: ${result.coveredKeys.length}/10`,
    `Contract: deterministic values/status/trends/refs/actions + model-drafted explanations`,
    `Confidence/ECE: evidence-strength heuristic, not P(correct); ECE N/A`,
    `Verdict: ${result.verdict} — ${result.verdictReasons.join('; ') || 'all GREEN criteria met'}`,
    `Fabrication leaks: ${result.fabricationLeaks} ← MUST be 0`,
    `Grounding fidelity: ${percent(result.groundingFidelity)}`,
    `Accuracy vs golden properties: ${percent(result.accuracyRate)}`,
    `Thin insufficient_data: ${result.thinCorrect}/${result.thinSampleCount}`,
    `Confidence handling fidelity: ${percent(result.confidenceHandlingRate)}`,
    `Parse-valid raw proposals: ${result.parseValidSamples}/${result.paidCompletionCount}`,
    `Guardrail caught: ${result.guardrailCaught} explanation substitutions across ${result.samplesWithGuardrailCaught}/${result.paidCompletionCount} samples`,
    `  raw missing explanations: ${result.rawMissingExplanations}; unsupported raw numbers: ${result.rawUnsupportedNumbers}`,
    `Latency: mean ${Math.round(result.meanLatencyMs)} ms; σ ${Math.round(result.latencyStdDevMs)} ms; p95 ${Math.round(result.p95LatencyMs)} ms`,
    `Tokens: ${result.totalInputTokens} input; ${result.totalOutputTokens} output`,
    `Cost: $${result.totalCostUsd.toFixed(6)} (mean $${result.meanCostUsd.toFixed(6)}/sample)`,
    `Final-output variance: ${result.casesWithVariableFinalOutput}/${result.caseCount} cases varied`,
    `Raw-output variance: ${result.casesWithVariableRawOutput}/${result.caseCount} cases varied`,
    '',
    '| Case | Focus key | Kind | Accuracy | Grounding | Leaks | Thin | Catches | Mean ± σ ms | Mean tokens in/out | Cost | Distinct raw |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}