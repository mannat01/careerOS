import {
  groundMatchScore,
  rawMatchScoreProposalSchema,
  type MatchScore,
} from '@careeros/cie-resume';
import type { RealCampaignResponse } from './real-campaign-runtime.js';
import type { ScoringCase } from './types.js';

export const REAL_SCORING_RUNS_PER_CASE = 3;
export const THIN_EVIDENCE_CASE_IDS = new Set(['sc-02-weak-match']);

export type FitLabel = 'low' | 'moderate' | 'high';

export interface ReliabilityBin {
  label: string;
  min: number;
  max: number;
  count: number;
  meanConfidence: number | null;
  observedAccuracy: number | null;
}

export interface RealScoringSample {
  run: number;
  /** null on the insufficient_data arm (no fabricated number). */
  overall: number | null;
  rawOverall: number | null;
  bandCorrect: boolean;
  expectedLabel: FitLabel;
  predictedLabel: FitLabel;
  labelCorrect: boolean;
  confidenceAvailable: false;
  confidence: null;
  rawScoreOutsideBand: boolean;
  rawScoreCorrected: boolean;
  rawUngroundedEvidenceRefs: number;
  rawForbiddenClaims: number;
  rawMissingSubscores: number;
  guardrailCaught: number;
  fabricationLeaks: string[];
  thinEvidenceCase: boolean;
  thinFitHandled: boolean;
  thinUncertaintyHandled: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  outputSignature: string;
  rawOutputSignature: string;
  parseValid: boolean;
}

export interface RealScoringCaseResult {
  caseId: string;
  expectedBand: { min: number; max: number };
  expectedLabel: FitLabel;
  samples: RealScoringSample[];
  bandAccuracy: number;
  labelAccuracy: number;
  meanOverall: number;
  overallStdDev: number;
  overallRange: number;
  guardrailCaught: number;
  samplesWithGuardrailCaught: number;
  fabricationLeaks: number;
  thinFitHandledSamples: number;
  thinUncertaintyHandledSamples: number;
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
  distinctFinalOutputs: number;
  distinctRawOutputs: number;
}

export interface RealScoringCampaignResult {
  model: string;
  runsPerCase: number;
  caseCount: number;
  sampleCount: number;
  cases: RealScoringCaseResult[];
  bandAccuracy: number;
  labelAccuracy: number;
  confidenceAvailableSamples: number;
  reliabilityBins: ReliabilityBin[];
  ece: number | null;
  calibrationAssessment: 'unavailable';
  thinEvidenceSampleCount: number;
  thinFitHandledSamples: number;
  thinUncertaintyHandledSamples: number;
  guardrailCaught: number;
  rawScoreOutsideBand: number;
  rawScoreCorrections: number;
  rawUngroundedEvidenceRefs: number;
  rawForbiddenClaims: number;
  rawMissingSubscores: number;
  samplesWithGuardrailCaught: number;
  fabricationLeaks: number;
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
  meanOverallStdDev: number;
  casesWithVariableOverall: number;
  casesWithVariableFinalOutput: number;
  casesWithVariableRawOutput: number;
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

export function expectedFitLabel(c: ScoringCase): FitLabel {
  if (c.expectedBand.max <= 25) return 'low';
  if (c.expectedBand.min >= 75) return 'high';
  return 'moderate';
}

export function scoreFitLabel(overall: number): FitLabel {
  if (overall <= 25) return 'low';
  if (overall >= 75) return 'high';
  return 'moderate';
}

function parseRaw(text: string): ReturnType<typeof rawMatchScoreProposalSchema.safeParse> {
  try {
    return rawMatchScoreProposalSchema.safeParse(JSON.parse(text) as unknown);
  } catch {
    return rawMatchScoreProposalSchema.safeParse(null);
  }
}

function finalSignature(score: MatchScore): string {
  return score.status === 'ok'
    ? JSON.stringify({
        status: score.status,
        overall: score.overall,
        subscores: score.subscores,
        explanation: score.explanation,
        evidenceRefs: score.evidenceRefs,
      })
    : JSON.stringify({ status: score.status, reason: score.reason });
}

function independentLeaks(c: ScoringCase, produced: MatchScore): string[] {
  const leaks = new Set<string>();
  // Fabrication checks only apply to the `ok` arm; the insufficient_data arm
  // carries no number/subscores/evidence to leak (that refusal IS the honesty).
  if (produced.status === 'ok') {
    const realIds = new Set(c.profile.map((fact) => fact.id));
    for (const ref of produced.evidenceRefs) {
      if (!realIds.has(ref)) leaks.add(`ungrounded-evidence:${ref}`);
    }
    const explanation = produced.explanation.toLowerCase();
    for (const forbidden of c.forbidden ?? []) {
      if (explanation.includes(forbidden.toLowerCase())) leaks.add(`forbidden:${forbidden}`);
    }
  }
  const oracle = groundMatchScore(
    { overall: 0, subscores: [], explanation: '', evidenceRefs: [] },
    c.profile,
    c.job,
  );
  if (finalSignature(produced) !== finalSignature(oracle)) leaks.add('guardrail-recompute-mismatch');
  return [...leaks];
}

export function scoreRealScoringSample(input: {
  c: ScoringCase;
  run: number;
  rawText: string;
  produced: MatchScore;
  response: RealCampaignResponse;
  latencyMs: number;
}): RealScoringSample {
  const parsed = parseRaw(input.rawText);
  const raw = parsed.success ? parsed.data : null;
  // The final grounded output is a union. On the insufficient_data arm there is no
  // number to band-check — the honest refusal is itself the correct outcome for a
  // truly-thin profile (never a fabricated score).
  const producedOk = input.produced.status === 'ok' ? input.produced : null;
  const producedOverall = producedOk ? producedOk.overall : null;
  const producedInsufficient = input.produced.status === 'insufficient_data';
  const bandCorrect = producedOk
    ? producedOk.overall >= input.c.expectedBand.min && producedOk.overall <= input.c.expectedBand.max
    : (input.c.expectedStatus ?? 'ok') === 'insufficient_data';
  const expectedLabel = expectedFitLabel(input.c);
  const predictedLabel = producedOk ? scoreFitLabel(producedOk.overall) : 'low';
  const realIds = new Set(input.c.profile.map((fact) => fact.id));
  const rawUngroundedEvidenceRefs = raw?.evidenceRefs.filter((ref) => !realIds.has(ref)).length ?? 0;
  const rawExplanation = raw?.explanation.toLowerCase() ?? '';
  const rawForbiddenClaims = (input.c.forbidden ?? [])
    .filter((forbidden) => rawExplanation.includes(forbidden.toLowerCase())).length;
  const rawKeys = new Set(raw?.subscores.map((subscore) => subscore.key) ?? []);
  const rawMissingSubscores = input.c.requiredSubscores.filter((key) => !rawKeys.has(key)).length;
  const rawScoreOutsideBand = raw !== null &&
    (raw.overall < input.c.expectedBand.min || raw.overall > input.c.expectedBand.max);
  const rawScoreCorrected = raw !== null && producedOk !== null && raw.overall !== producedOk.overall;
  const thinEvidenceCase = THIN_EVIDENCE_CASE_IDS.has(input.c.id);
  const thinFitHandled = !thinEvidenceCase || (
    producedOk !== null &&
    producedOk.overall <= input.c.expectedBand.max &&
    producedOk.explanation.toLowerCase().includes('gaps named')
  );
  // The MatchScore union now carries an explicit insufficient_data arm: an
  // unassessable profile is handled honestly (a refusal, never a fabricated score).
  const thinUncertaintyHandled = producedInsufficient;

  return {
    run: input.run,
    overall: producedOverall,
    rawOverall: raw?.overall ?? null,
    bandCorrect,
    expectedLabel,
    predictedLabel,
    labelCorrect: expectedLabel === predictedLabel,
    confidenceAvailable: false,
    confidence: null,
    rawScoreOutsideBand,
    rawScoreCorrected,
    rawUngroundedEvidenceRefs,
    rawForbiddenClaims,
    rawMissingSubscores,
    guardrailCaught:
      Number(rawScoreOutsideBand) + rawUngroundedEvidenceRefs + rawForbiddenClaims + rawMissingSubscores,
    fabricationLeaks: independentLeaks(input.c, input.produced),
    thinEvidenceCase,
    thinFitHandled,
    thinUncertaintyHandled,
    latencyMs: input.latencyMs,
    inputTokens: input.response.usage.inputTokens,
    outputTokens: input.response.usage.outputTokens,
    costUsd: input.response.costUsd,
    outputSignature: finalSignature(input.produced),
    rawOutputSignature: input.rawText,
    parseValid: parsed.success,
  };
}

export function aggregateRealScoringCampaign(
  model: string,
  byCase: Array<{ c: ScoringCase; samples: RealScoringSample[] }>,
): RealScoringCampaignResult {
  const cases = byCase.map(({ c, samples }) => {
    // Only `ok`-arm samples carry a number; insufficient_data samples contribute
    // no overall to the numeric aggregates (they are counted via thin-uncertainty).
    const overall = samples
      .map((sample) => sample.overall)
      .filter((value): value is number => value !== null);
    const latencies = samples.map((sample) => sample.latencyMs);
    const costs = samples.map((sample) => sample.costUsd);
    return {
      caseId: c.id,
      expectedBand: c.expectedBand,
      expectedLabel: expectedFitLabel(c),
      samples,
      bandAccuracy: mean(samples.map((sample) => Number(sample.bandCorrect))),
      labelAccuracy: mean(samples.map((sample) => Number(sample.labelCorrect))),
      meanOverall: mean(overall),
      overallStdDev: standardDeviation(overall),
      overallRange: overall.length === 0 ? 0 : Math.max(...overall) - Math.min(...overall),
      guardrailCaught: samples.reduce((sum, sample) => sum + sample.guardrailCaught, 0),
      samplesWithGuardrailCaught: samples.filter((sample) => sample.guardrailCaught > 0).length,
      fabricationLeaks: samples.reduce((sum, sample) => sum + sample.fabricationLeaks.length, 0),
      thinFitHandledSamples: samples.filter((sample) => sample.thinEvidenceCase && sample.thinFitHandled).length,
      thinUncertaintyHandledSamples: samples.filter((sample) => sample.thinEvidenceCase && sample.thinUncertaintyHandled).length,
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
      distinctFinalOutputs: new Set(samples.map((sample) => sample.outputSignature)).size,
      distinctRawOutputs: new Set(samples.map((sample) => sample.rawOutputSignature)).size,
    } satisfies RealScoringCaseResult;
  });
  const samples = cases.flatMap((result) => result.samples);
  const latencies = samples.map((sample) => sample.latencyMs);
  const costs = samples.map((sample) => sample.costUsd);
  const reliabilityBins: ReliabilityBin[] = [
    { label: '0.00–0.49', min: 0, max: 0.49, count: 0, meanConfidence: null, observedAccuracy: null },
    { label: '0.50–0.79', min: 0.5, max: 0.79, count: 0, meanConfidence: null, observedAccuracy: null },
    { label: '0.80–1.00', min: 0.8, max: 1, count: 0, meanConfidence: null, observedAccuracy: null },
  ];

  return {
    model,
    runsPerCase: REAL_SCORING_RUNS_PER_CASE,
    caseCount: cases.length,
    sampleCount: samples.length,
    cases,
    bandAccuracy: mean(samples.map((sample) => Number(sample.bandCorrect))),
    labelAccuracy: mean(samples.map((sample) => Number(sample.labelCorrect))),
    confidenceAvailableSamples: 0,
    reliabilityBins,
    ece: null,
    calibrationAssessment: 'unavailable',
    thinEvidenceSampleCount: samples.filter((sample) => sample.thinEvidenceCase).length,
    thinFitHandledSamples: samples.filter((sample) => sample.thinEvidenceCase && sample.thinFitHandled).length,
    thinUncertaintyHandledSamples: samples.filter((sample) => sample.thinEvidenceCase && sample.thinUncertaintyHandled).length,
    guardrailCaught: samples.reduce((sum, sample) => sum + sample.guardrailCaught, 0),
    rawScoreOutsideBand: samples.filter((sample) => sample.rawScoreOutsideBand).length,
    rawScoreCorrections: samples.filter((sample) => sample.rawScoreCorrected).length,
    rawUngroundedEvidenceRefs: samples.reduce((sum, sample) => sum + sample.rawUngroundedEvidenceRefs, 0),
    rawForbiddenClaims: samples.reduce((sum, sample) => sum + sample.rawForbiddenClaims, 0),
    rawMissingSubscores: samples.reduce((sum, sample) => sum + sample.rawMissingSubscores, 0),
    samplesWithGuardrailCaught: samples.filter((sample) => sample.guardrailCaught > 0).length,
    fabricationLeaks: samples.reduce((sum, sample) => sum + sample.fabricationLeaks.length, 0),
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
    meanOverallStdDev: mean(cases.map((result) => result.overallStdDev)),
    casesWithVariableOverall: cases.filter((result) => result.overallRange > 0).length,
    casesWithVariableFinalOutput: cases.filter((result) => result.distinctFinalOutputs > 1).length,
    casesWithVariableRawOutput: cases.filter((result) => result.distinctRawOutputs > 1).length,
  };
}

export function formatRealScoringCampaign(result: RealScoringCampaignResult): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const rows = result.cases.map((c) => {
    const raw = c.samples.map((sample) => sample.rawOverall ?? 'invalid').join(' / ');
    return `| ${c.caseId} | ${c.expectedBand.min}–${c.expectedBand.max} (${c.expectedLabel}) | ${c.samples.map((sample) => sample.overall).join(' / ')} | ${percent(c.bandAccuracy)} | ${percent(c.labelAccuracy)} | ${raw} | ${c.guardrailCaught} (${c.samplesWithGuardrailCaught}/3) | ${c.fabricationLeaks} | ${Math.round(c.meanLatencyMs)} ± ${Math.round(c.latencyStdDevMs)} | ${Math.round(c.meanInputTokens)} ± ${Math.round(c.inputTokensStdDev)} / ${Math.round(c.meanOutputTokens)} ± ${Math.round(c.outputTokensStdDev)} | $${c.totalCostUsd.toFixed(6)} | ${c.distinctRawOutputs}/3 |`;
  });
  return [
    `Model: ${result.model}`,
    `Samples: ${result.sampleCount} (${result.caseCount} cases × ${result.runsPerCase})`,
    `Band accuracy: ${percent(result.bandAccuracy)}`,
    `Fit-label accuracy: ${percent(result.labelAccuracy)}`,
    `Confidence/ECE: unavailable (${result.confidenceAvailableSamples}/${result.sampleCount} outputs expose confidence)`,
    `Thin evidence: fit ${result.thinFitHandledSamples}/${result.thinEvidenceSampleCount}; uncertainty ${result.thinUncertaintyHandledSamples}/${result.thinEvidenceSampleCount}`,
    `Guardrail caught: ${result.guardrailCaught} across ${result.samplesWithGuardrailCaught}/${result.sampleCount} samples`,
    `Fabrication leaks: ${result.fabricationLeaks}`,
    `Latency: mean ${Math.round(result.meanLatencyMs)} ms; σ ${Math.round(result.latencyStdDevMs)} ms; p95 ${Math.round(result.p95LatencyMs)} ms`,
    `Tokens: ${result.totalInputTokens} input; ${result.totalOutputTokens} output`,
    `Cost: $${result.totalCostUsd.toFixed(6)}`,
    `Final-score variance: mean per-case σ ${result.meanOverallStdDev.toFixed(2)}; ${result.casesWithVariableOverall}/${result.caseCount} cases varied`,
    `Raw-output variance: ${result.casesWithVariableRawOutput}/${result.caseCount} cases varied`,
    '',
    '| Case | Expected band/label | Final scores 1/2/3 | Band accuracy | Label accuracy | Raw scores 1/2/3 | Catches | Leaks | Mean ± σ ms | Mean ± σ tokens in/out | Cost | Distinct raw |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}
