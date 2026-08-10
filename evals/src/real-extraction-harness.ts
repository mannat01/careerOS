import {
  groundEntities,
  normalizeEntity,
  rawExtractionSchema,
  type NormalizedEntity,
  type RawEntity,
} from '@careeros/agents';
import type { LlmProvider, LlmResponse } from '@careeros/llm-gateway';
import { expectedName, scoreExtractionCase } from './harness.js';
import type { ExtractedEntity, ExtractionCase } from './types.js';

export const REAL_RUNS_PER_CASE = 3;

export interface RecordedCompletion {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** Records raw model output without bypassing or changing the real provider. */
export class RecordingLlmProvider implements LlmProvider {
  readonly vendor: string;
  readonly completions: RecordedCompletion[] = [];

  constructor(private readonly inner: LlmProvider) {
    this.vendor = inner.vendor;
  }

  async complete(req: Parameters<LlmProvider['complete']>[0]): Promise<RecordedCompletion> {
    const completion = await this.inner.complete(req);
    this.completions.push(completion);
    return completion;
  }
}

export interface RealExtractionSample {
  run: number;
  recall: number;
  matchedCount: number;
  expectedCount: number;
  provenanceCorrect: number;
  producedCount: number;
  provenanceCorrectness: number;
  guardrailCaught: number;
  fabricationLeaks: string[];
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  outputSignature: string;
  parseValid: boolean;
}

export interface RealExtractionCaseResult {
  caseId: string;
  format: ExtractionCase['format'];
  samples: RealExtractionSample[];
  meanRecall: number;
  recallStdDev: number;
  recallRange: number;
  distinctOutputs: number;
  guardrailCaught: number;
  fabricationLeaks: number;
  meanLatencyMs: number;
  totalCostUsd: number;
}

export interface RealExtractionCampaignResult {
  model: string;
  runsPerCase: number;
  caseCount: number;
  sampleCount: number;
  cases: RealExtractionCaseResult[];
  overallRecall: number;
  provenanceCorrectness: number;
  guardrailCaught: number;
  fabricationLeaks: number;
  meanLatencyMs: number;
  p95LatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  meanRecallStdDev: number;
  casesWithVariableRecall: number;
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

function structuredText(entity: { kind: string; name: string; detail?: string }): string {
  return `${entity.kind} ${entity.name} ${entity.detail ?? ''}`.toLowerCase();
}

function parseRaw(text: string): RawEntity[] | null {
  try {
    const parsed = rawExtractionSchema.safeParse(JSON.parse(text) as unknown);
    return parsed.success ? parsed.data.entities : null;
  } catch {
    return null;
  }
}

function isVerbatimGrounded(entity: NormalizedEntity, sourceText: string): boolean {
  return groundEntities([entity], sourceText).length === 1;
}

function outputSignature(entities: ExtractedEntity[]): string {
  return entities
    .map((entity) => `${entity.kind}:${entity.name.toLowerCase()}:${entity.detail?.toLowerCase() ?? ''}:${entity.provenance?.quote ?? ''}`)
    .sort()
    .join('|');
}

function independentLeaks(c: ExtractionCase, produced: ExtractedEntity[]): string[] {
  const leaks = new Set<string>();
  const finalText = produced.map(structuredText).join('\n');
  const collapsedSource = c.resumeText.replace(/\s+/g, ' ').trim().toLowerCase();
  const fieldGrounded = (value: string | undefined): boolean =>
    value === undefined || collapsedSource.includes(value.replace(/\s+/g, ' ').trim().toLowerCase());
  for (const forbidden of c.forbidden ?? []) {
    if (finalText.includes(forbidden.toLowerCase())) leaks.add(`forbidden:${forbidden}`);
  }
  for (const entity of produced) {
    if (!entity.provenance || !c.resumeText.includes(entity.provenance.quote)) {
      leaks.add(`ungrounded:${entity.kind}:${entity.name}`);
    }
    if (entity.kind !== 'skill' && !fieldGrounded(entity.name)) {
      leaks.add(`ungrounded-name:${entity.kind}:${entity.name}`);
    }
    if ((entity.kind === 'experience' || entity.kind === 'education') && !fieldGrounded(entity.detail)) {
      leaks.add(`ungrounded-detail:${entity.kind}:${entity.detail ?? ''}`);
    }
  }
  return [...leaks];
}

export function scoreRealExtractionSample(input: {
  c: ExtractionCase;
  run: number;
  rawText: string;
  produced: ExtractedEntity[];
  response: Pick<LlmResponse, 'usage' | 'costUsd'>;
  latencyMs: number;
}): RealExtractionSample {
  const scored = scoreExtractionCase(input.c, input.produced);
  const raw = parseRaw(input.rawText);
  const normalizedRaw = raw?.map(normalizeEntity) ?? [];
  const guardrailCaught = normalizedRaw.filter((entity) => !isVerbatimGrounded(entity, input.c.resumeText)).length;
  const provenanceCorrect = input.produced.filter(
    (entity) => entity.provenance !== undefined && input.c.resumeText.includes(entity.provenance.quote),
  ).length;

  return {
    run: input.run,
    recall: scored.recall,
    matchedCount: scored.matchedCount,
    expectedCount: scored.expectedCount,
    provenanceCorrect,
    producedCount: input.produced.length,
    provenanceCorrectness: input.produced.length === 0 ? 1 : provenanceCorrect / input.produced.length,
    guardrailCaught,
    fabricationLeaks: independentLeaks(input.c, input.produced),
    latencyMs: input.latencyMs,
    inputTokens: input.response.usage.inputTokens,
    outputTokens: input.response.usage.outputTokens,
    costUsd: input.response.costUsd,
    outputSignature: outputSignature(input.produced),
    parseValid: raw !== null,
  };
}

export function aggregateRealExtractionCampaign(
  model: string,
  byCase: Array<{ c: ExtractionCase; samples: RealExtractionSample[] }>,
): RealExtractionCampaignResult {
  const cases = byCase.map(({ c, samples }): RealExtractionCaseResult => {
    const recalls = samples.map((sample) => sample.recall);
    return {
      caseId: c.id,
      format: c.format,
      samples,
      meanRecall: mean(recalls),
      recallStdDev: standardDeviation(recalls),
      recallRange: recalls.length === 0 ? 0 : Math.max(...recalls) - Math.min(...recalls),
      distinctOutputs: new Set(samples.map((sample) => sample.outputSignature)).size,
      guardrailCaught: samples.reduce((sum, sample) => sum + sample.guardrailCaught, 0),
      fabricationLeaks: samples.reduce((sum, sample) => sum + sample.fabricationLeaks.length, 0),
      meanLatencyMs: mean(samples.map((sample) => sample.latencyMs)),
      totalCostUsd: samples.reduce((sum, sample) => sum + sample.costUsd, 0),
    };
  });
  const samples = cases.flatMap((result) => result.samples);
  const matchedTotal = samples.reduce((sum, sample) => sum + sample.matchedCount, 0);
  const expectedTotal = samples.reduce((sum, sample) => sum + sample.expectedCount, 0);
  const provenanceCorrect = samples.reduce((sum, sample) => sum + sample.provenanceCorrect, 0);
  const producedTotal = samples.reduce((sum, sample) => sum + sample.producedCount, 0);

  return {
    model,
    runsPerCase: REAL_RUNS_PER_CASE,
    caseCount: cases.length,
    sampleCount: samples.length,
    cases,
    overallRecall: expectedTotal === 0 ? 1 : matchedTotal / expectedTotal,
    provenanceCorrectness: producedTotal === 0 ? 1 : provenanceCorrect / producedTotal,
    guardrailCaught: samples.reduce((sum, sample) => sum + sample.guardrailCaught, 0),
    fabricationLeaks: samples.reduce((sum, sample) => sum + sample.fabricationLeaks.length, 0),
    meanLatencyMs: mean(samples.map((sample) => sample.latencyMs)),
    p95LatencyMs: percentile95(samples.map((sample) => sample.latencyMs)),
    totalInputTokens: samples.reduce((sum, sample) => sum + sample.inputTokens, 0),
    totalOutputTokens: samples.reduce((sum, sample) => sum + sample.outputTokens, 0),
    totalCostUsd: samples.reduce((sum, sample) => sum + sample.costUsd, 0),
    meanRecallStdDev: mean(cases.map((result) => result.recallStdDev)),
    casesWithVariableRecall: cases.filter((result) => result.recallRange > 0).length,
    casesWithVariableOutput: cases.filter((result) => result.distinctOutputs > 1).length,
  };
}

/** Human-readable campaign output that can be copied directly into the report. */
export function formatRealExtractionCampaign(result: RealExtractionCampaignResult): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const rows = result.cases.map((c) => {
    const recalls = c.samples.map((sample) => percent(sample.recall)).join(' / ');
    const provenance = c.samples.map((sample) => percent(sample.provenanceCorrectness)).join(' / ');
    return `| ${c.caseId} | ${recalls} | ${percent(c.meanRecall)} | ${provenance} | ${c.guardrailCaught} | ${c.fabricationLeaks} | ${Math.round(c.meanLatencyMs)} | $${c.totalCostUsd.toFixed(6)} | ${c.distinctOutputs}/3 |`;
  });
  return [
    `Model: ${result.model}`,
    `Samples: ${result.sampleCount} (${result.caseCount} cases × ${result.runsPerCase})`,
    `Overall recall: ${percent(result.overallRecall)}`,
    `Verbatim provenance: ${percent(result.provenanceCorrectness)}`,
    `Guardrail caught: ${result.guardrailCaught}`,
    `Fabrication leaks: ${result.fabricationLeaks}`,
    `Latency: mean ${Math.round(result.meanLatencyMs)} ms; p95 ${Math.round(result.p95LatencyMs)} ms`,
    `Tokens: ${result.totalInputTokens} input; ${result.totalOutputTokens} output`,
    `Cost: $${result.totalCostUsd.toFixed(6)}`,
    `Recall variance: mean per-case σ ${percent(result.meanRecallStdDev)}; ${result.casesWithVariableRecall}/${result.caseCount} cases varied`,
    `Output variance: ${result.casesWithVariableOutput}/${result.caseCount} cases had >1 distinct final entity set`,
    '',
    '| Case | Recall runs 1/2/3 | Mean | Verbatim provenance runs 1/2/3 | Caught | Leaks | Mean ms | Cost | Distinct outputs |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}

/** Utility used in report diagnostics to list missed expected entities. */
export function missedExpectedEntities(c: ExtractionCase, produced: ExtractedEntity[]): string[] {
  return c.expected
    .filter((expected) => !produced.some(
      (entity) => entity.kind === expected.kind && entity.name.trim().toLowerCase() === expectedName(expected).trim().toLowerCase(),
    ))
    .map((expected) => `${expected.kind}:${expectedName(expected)}`);
}