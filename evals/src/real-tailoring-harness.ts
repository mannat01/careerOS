import {
  atsCheck,
  isTextGrounded,
  rawTailorProposalSchema,
  renderVariant,
  type TailorVariantResult,
} from '@careeros/cie-resume';
import type { RealCampaignResponse } from './real-campaign-runtime.js';
import type { TailoringCase } from './types.js';

export const REAL_TAILORING_RUNS_PER_CASE = 3;

export interface RealTailoringSample {
  run: number;
  relevance: number;
  matchedRelevantCount: number;
  expectedRelevantCount: number;
  producedCount: number;
  rephrasedCount: number;
  faithfulRephrasedCount: number;
  rephrasingFaithfulness: number;
  structuralCatches: number;
  lexicalCatches: number;
  guardrailCaught: number;
  fabricationLeaks: string[];
  atsPresent: boolean;
  atsValid: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  outputSignature: string;
  parseValid: boolean;
}

export interface RealTailoringCaseResult {
  caseId: string;
  adversarial: boolean;
  samples: RealTailoringSample[];
  meanRelevance: number;
  relevanceStdDev: number;
  relevanceRange: number;
  rephrasingFaithfulness: number;
  guardrailCaught: number;
  samplesWithGuardrailCaught: number;
  fabricationLeaks: number;
  atsValidSamples: number;
  meanLatencyMs: number;
  latencyStdDevMs: number;
  latencyRangeMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  meanInputTokens: number;
  inputTokensStdDev: number;
  meanOutputTokens: number;
  outputTokensStdDev: number;
  totalCostUsd: number;
  meanCostUsd: number;
  costStdDevUsd: number;
  distinctOutputs: number;
}

export interface RealTailoringCampaignResult {
  model: string;
  runsPerCase: number;
  caseCount: number;
  sampleCount: number;
  cases: RealTailoringCaseResult[];
  overallRelevance: number;
  rephrasingFaithfulness: number;
  rephrasedCount: number;
  faithfulRephrasedCount: number;
  guardrailCaught: number;
  structuralCatches: number;
  lexicalCatches: number;
  samplesWithGuardrailCaught: number;
  fabricationLeaks: number;
  atsValidSamples: number;
  parseValidSamples: number;
  meanLatencyMs: number;
  latencyStdDevMs: number;
  latencyRangeMs: number;
  p95LatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  meanInputTokens: number;
  inputTokensStdDev: number;
  meanOutputTokens: number;
  outputTokensStdDev: number;
  totalCostUsd: number;
  meanCostUsd: number;
  costStdDevUsd: number;
  meanRelevanceStdDev: number;
  casesWithVariableRelevance: number;
  casesWithVariableOutput: number;
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

function parseRaw(text: string): ReturnType<typeof rawTailorProposalSchema.safeParse> {
  try {
    return rawTailorProposalSchema.safeParse(JSON.parse(text) as unknown);
  } catch {
    return rawTailorProposalSchema.safeParse(null);
  }
}

function independentLeaks(c: TailoringCase, produced: TailorVariantResult): string[] {
  const leaks = new Set<string>();
  const byId = new Map(c.profile.map((fact) => [fact.id, fact]));
  for (const bullet of produced.bullets) {
    const fact = byId.get(bullet.factId);
    if (!fact) {
      leaks.add(`ungrounded-fact:${bullet.factId || '(missing)'}`);
    } else if (!isTextGrounded(bullet.text, fact)) {
      leaks.add(`unfaithful:${bullet.factId}:${bullet.text}`);
    }
  }
  const rendered = produced.rendered.toLowerCase();
  for (const forbidden of c.forbidden ?? []) {
    if (rendered.includes(forbidden.toLowerCase())) leaks.add(`forbidden:${forbidden}`);
  }
  if (produced.rendered !== renderVariant(produced.bullets)) leaks.add('render-mismatch');
  return [...leaks];
}

function outputSignature(produced: TailorVariantResult): string {
  return produced.bullets
    .map((bullet) => `${bullet.factId}:${bullet.text.toLowerCase()}`)
    .join('|');
}

export function scoreRealTailoringSample(input: {
  c: TailoringCase;
  run: number;
  rawText: string;
  produced: TailorVariantResult;
  response: RealCampaignResponse;
  latencyMs: number;
}): RealTailoringSample {
  const parsed = parseRaw(input.rawText);
  const rawBullets = parsed.success ? parsed.data.bullets : [];
  const byId = new Map(input.c.profile.map((fact) => [fact.id, fact]));
  const structuralCatches = rawBullets.filter((bullet) => !byId.has(bullet.factId)).length;
  const lexicalCatches = rawBullets.filter((bullet) => {
    const fact = byId.get(bullet.factId);
    return fact !== undefined && !isTextGrounded(bullet.text, fact);
  }).length;
  const selected = new Set(input.produced.bullets.map((bullet) => bullet.factId));
  const matchedRelevantCount = input.c.expectedRelevantFactIds.filter((id) => selected.has(id)).length;
  const rephrased = input.produced.bullets.filter((bullet) => {
    const fact = byId.get(bullet.factId);
    return fact !== undefined && bullet.text !== fact.summary;
  });
  const faithfulRephrasedCount = rephrased.filter((bullet) => {
    const fact = byId.get(bullet.factId);
    return fact !== undefined && isTextGrounded(bullet.text, fact);
  }).length;
  const independentAts = atsCheck(input.produced.rendered);
  const atsPresent = typeof input.produced.atsCheck?.passed === 'boolean' && Array.isArray(input.produced.atsCheck.warnings);
  const atsValid = atsPresent && input.produced.atsCheck.passed && independentAts.passed;

  return {
    run: input.run,
    relevance: input.c.expectedRelevantFactIds.length === 0
      ? 1
      : matchedRelevantCount / input.c.expectedRelevantFactIds.length,
    matchedRelevantCount,
    expectedRelevantCount: input.c.expectedRelevantFactIds.length,
    producedCount: input.produced.bullets.length,
    rephrasedCount: rephrased.length,
    faithfulRephrasedCount,
    rephrasingFaithfulness: rephrased.length === 0 ? 1 : faithfulRephrasedCount / rephrased.length,
    structuralCatches,
    lexicalCatches,
    guardrailCaught: structuralCatches + lexicalCatches,
    fabricationLeaks: independentLeaks(input.c, input.produced),
    atsPresent,
    atsValid,
    latencyMs: input.latencyMs,
    inputTokens: input.response.usage.inputTokens,
    outputTokens: input.response.usage.outputTokens,
    costUsd: input.response.costUsd,
    outputSignature: outputSignature(input.produced),
    parseValid: parsed.success,
  };
}

export function aggregateRealTailoringCampaign(
  model: string,
  byCase: Array<{ c: TailoringCase; samples: RealTailoringSample[] }>,
): RealTailoringCampaignResult {
  const cases = byCase.map(({ c, samples }) => {
    const relevance = samples.map((sample) => sample.relevance);
    const rephrasedCount = samples.reduce((sum, sample) => sum + sample.rephrasedCount, 0);
    const faithfulRephrasedCount = samples.reduce((sum, sample) => sum + sample.faithfulRephrasedCount, 0);
    const latencies = samples.map((sample) => sample.latencyMs);
    const costs = samples.map((sample) => sample.costUsd);
    return {
      caseId: c.id,
      adversarial: c.adversarial ?? false,
      samples,
      meanRelevance: mean(relevance),
      relevanceStdDev: standardDeviation(relevance),
      relevanceRange: Math.max(...relevance) - Math.min(...relevance),
      rephrasingFaithfulness: rephrasedCount === 0 ? 1 : faithfulRephrasedCount / rephrasedCount,
      guardrailCaught: samples.reduce((sum, sample) => sum + sample.guardrailCaught, 0),
      samplesWithGuardrailCaught: samples.filter((sample) => sample.guardrailCaught > 0).length,
      fabricationLeaks: samples.reduce((sum, sample) => sum + sample.fabricationLeaks.length, 0),
      atsValidSamples: samples.filter((sample) => sample.atsValid).length,
      meanLatencyMs: mean(latencies),
      latencyStdDevMs: standardDeviation(latencies),
      latencyRangeMs: Math.max(...latencies) - Math.min(...latencies),
      totalInputTokens: samples.reduce((sum, sample) => sum + sample.inputTokens, 0),
      totalOutputTokens: samples.reduce((sum, sample) => sum + sample.outputTokens, 0),
      meanInputTokens: mean(samples.map((sample) => sample.inputTokens)),
      inputTokensStdDev: standardDeviation(samples.map((sample) => sample.inputTokens)),
      meanOutputTokens: mean(samples.map((sample) => sample.outputTokens)),
      outputTokensStdDev: standardDeviation(samples.map((sample) => sample.outputTokens)),
      totalCostUsd: costs.reduce((sum, cost) => sum + cost, 0),
      meanCostUsd: mean(costs),
      costStdDevUsd: standardDeviation(costs),
      distinctOutputs: new Set(samples.map((sample) => sample.outputSignature)).size,
    } satisfies RealTailoringCaseResult;
  });
  const samples = cases.flatMap((result) => result.samples);
  const matched = samples.reduce((sum, sample) => sum + sample.matchedRelevantCount, 0);
  const expected = samples.reduce((sum, sample) => sum + sample.expectedRelevantCount, 0);
  const rephrasedCount = samples.reduce((sum, sample) => sum + sample.rephrasedCount, 0);
  const faithfulRephrasedCount = samples.reduce((sum, sample) => sum + sample.faithfulRephrasedCount, 0);
  const latencies = samples.map((sample) => sample.latencyMs);
  const costs = samples.map((sample) => sample.costUsd);

  return {
    model,
    runsPerCase: REAL_TAILORING_RUNS_PER_CASE,
    caseCount: cases.length,
    sampleCount: samples.length,
    cases,
    overallRelevance: expected === 0 ? 1 : matched / expected,
    rephrasingFaithfulness: rephrasedCount === 0 ? 1 : faithfulRephrasedCount / rephrasedCount,
    rephrasedCount,
    faithfulRephrasedCount,
    guardrailCaught: samples.reduce((sum, sample) => sum + sample.guardrailCaught, 0),
    structuralCatches: samples.reduce((sum, sample) => sum + sample.structuralCatches, 0),
    lexicalCatches: samples.reduce((sum, sample) => sum + sample.lexicalCatches, 0),
    samplesWithGuardrailCaught: samples.filter((sample) => sample.guardrailCaught > 0).length,
    fabricationLeaks: samples.reduce((sum, sample) => sum + sample.fabricationLeaks.length, 0),
    atsValidSamples: samples.filter((sample) => sample.atsValid).length,
    parseValidSamples: samples.filter((sample) => sample.parseValid).length,
    meanLatencyMs: mean(latencies),
    latencyStdDevMs: standardDeviation(latencies),
    latencyRangeMs: Math.max(...latencies) - Math.min(...latencies),
    p95LatencyMs: percentile95(latencies),
    totalInputTokens: samples.reduce((sum, sample) => sum + sample.inputTokens, 0),
    totalOutputTokens: samples.reduce((sum, sample) => sum + sample.outputTokens, 0),
    meanInputTokens: mean(samples.map((sample) => sample.inputTokens)),
    inputTokensStdDev: standardDeviation(samples.map((sample) => sample.inputTokens)),
    meanOutputTokens: mean(samples.map((sample) => sample.outputTokens)),
    outputTokensStdDev: standardDeviation(samples.map((sample) => sample.outputTokens)),
    totalCostUsd: costs.reduce((sum, cost) => sum + cost, 0),
    meanCostUsd: mean(costs),
    costStdDevUsd: standardDeviation(costs),
    meanRelevanceStdDev: mean(cases.map((result) => result.relevanceStdDev)),
    casesWithVariableRelevance: cases.filter((result) => result.relevanceRange > 0).length,
    casesWithVariableOutput: cases.filter((result) => result.distinctOutputs > 1).length,
  };
}

export function formatRealTailoringCampaign(result: RealTailoringCampaignResult): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const rows = result.cases.map((c) => {
    const relevance = c.samples.map((sample) => percent(sample.relevance)).join(' / ');
    return `| ${c.caseId} | ${relevance} | ${percent(c.meanRelevance)} | ${percent(c.rephrasingFaithfulness)} | ${c.guardrailCaught} (${c.samplesWithGuardrailCaught}/3) | ${c.fabricationLeaks} | ${c.atsValidSamples}/3 | ${Math.round(c.meanLatencyMs)} ± ${Math.round(c.latencyStdDevMs)} | ${Math.round(c.meanInputTokens)} ± ${Math.round(c.inputTokensStdDev)} / ${Math.round(c.meanOutputTokens)} ± ${Math.round(c.outputTokensStdDev)} | $${c.totalCostUsd.toFixed(6)} | ${c.distinctOutputs}/3 |`;
  });
  return [
    `Model: ${result.model}`,
    `Samples: ${result.sampleCount} (${result.caseCount} cases × ${result.runsPerCase})`,
    `Selection relevance: ${percent(result.overallRelevance)}`,
    `Rephrasing faithfulness: ${percent(result.rephrasingFaithfulness)} (${result.faithfulRephrasedCount}/${result.rephrasedCount})`,
    `Guardrail caught: ${result.guardrailCaught} (${result.structuralCatches} structural; ${result.lexicalCatches} lexical) across ${result.samplesWithGuardrailCaught}/${result.sampleCount} samples`,
    `Fabrication leaks: ${result.fabricationLeaks}`,
    `ATS valid: ${result.atsValidSamples}/${result.sampleCount}`,
    `Latency: mean ${Math.round(result.meanLatencyMs)} ms; σ ${Math.round(result.latencyStdDevMs)} ms; p95 ${Math.round(result.p95LatencyMs)} ms`,
    `Tokens: ${result.totalInputTokens} input; ${result.totalOutputTokens} output`,
    `Cost: $${result.totalCostUsd.toFixed(6)}`,
    `Relevance variance: mean per-case σ ${percent(result.meanRelevanceStdDev)}; ${result.casesWithVariableRelevance}/${result.caseCount} cases varied`,
    `Output variance: ${result.casesWithVariableOutput}/${result.caseCount} cases varied`,
    '',
    '| Case | Relevance runs 1/2/3 | Mean | Rephrasing faithful | Caught (samples) | Leaks | ATS | Mean ± σ ms | Mean ± σ tokens in/out | Cost | Distinct outputs |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}