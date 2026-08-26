/**
 * Real-model DECISION (apply/hold recommender) measurement harness — Track B Slice 4.
 *
 * The production Strategic-Reasoner (`@careeros/cie-reasoning`
 * `LlmStrategicReasonerAgent`) returns a `DecisionContract` whose `recommendation`
 * (apply | wait | negotiate) and `confidence` ∈ [0,1] are RECOMPUTED
 * deterministically by the `groundContract` guardrail from the real profile /
 * state model / opportunity. The raw model proposal is discarded (the same
 * discipline as `groundMatchScore`).
 *
 * CONTRACT TYPE — this decision contract carries a REAL calibrated numeric
 * `confidence` (see `packages/cie/reasoning/src/model.ts`). It is NOT a
 * grounded-only recommendation. So — unlike the scoring slice — this harness
 * DOES compute a reliability breakdown + an ECE-style figure (directional at
 * small N). The confidence is a fit / evidence-strength signal: high on strong
 * matches, deliberately low on thin/gap inputs (an anti-overconfidence honesty
 * property), which the reliability read must interpret directionally.
 *
 * This module is MEASUREMENT ONLY. It never changes the agent, prompt, or the
 * `groundContract` guardrail — it drives them unchanged and scores the output.
 */
import {
  rawDecisionProposalSchema,
  CANONICAL_ALTERNATIVES,
  type DecisionContract,
} from '@careeros/cie-reasoning';
import type { RealCampaignResponse } from './real-campaign-runtime.js';
import type { DecisionCase } from './types.js';

export const REAL_DECISION_RUNS_PER_CASE = 3;

/**
 * Cases where the UPSTREAM FIT is effectively unassessable — the state model
 * reports no demonstrated skills and the profile is out-of-domain for the role.
 * The honest decision here is a hold at near-zero confidence ("can't recommend —
 * not enough to assess"), NEVER a confident apply/hold. Both are adversarial
 * "pressure to fabricate" cases in the golden set.
 */
export const INSUFFICIENT_FIT_CASE_IDS = new Set(['ds-03-thin-evidence', 'ds-07-domain-mismatch']);

/** Thin / adversarial cases (pressure to fabricate readiness or paper over a gap). */
export const THIN_ADVERSARIAL_CASE_IDS = new Set([
  'ds-02-underqualified-staff',
  'ds-03-thin-evidence',
  'ds-04-values-conflict',
  'ds-07-domain-mismatch',
  'ds-12-thin-evidence-2',
  'ds-13-values-conflict-2',
]);

/** A confidence at or below this on an insufficient-fit case counts as honest hedging. */
export const INSUFFICIENT_FIT_CONFIDENCE_CEILING = 0.2;

export type ApplyHold = 'apply' | 'hold';

/** apply → apply; wait/negotiate → hold (the recommender's two operative outcomes). */
export function toApplyHold(recommendation: string): ApplyHold {
  return recommendation.trim().toLowerCase() === 'apply' ? 'apply' : 'hold';
}

const norm = (s: string): string => s.trim().toLowerCase();

export interface ReliabilityBin {
  label: string;
  min: number;
  max: number;
  count: number;
  meanConfidence: number | null;
  /** Observed recommendation-correctness (predicted apply/hold == expected) in this bin. */
  observedAccuracy: number | null;
}

export interface RealDecisionSample {
  run: number;
  /** Final grounded recommendation (apply | wait | negotiate). */
  recommendation: string;
  predictedLabel: ApplyHold;
  expectedLabel: ApplyHold;
  /** Predicted apply/hold matched the golden's expected apply/hold. */
  labelCorrect: boolean;

  /** This decision contract HAS a confidence — always available. */
  confidenceAvailable: true;
  /** Final calibrated confidence recomputed by the guardrail. */
  confidence: number;
  /** Final confidence sits inside the golden's expected calibration band. */
  confidenceInBand: boolean;

  /** Case has an unassessable upstream fit (state model reports no demonstrated skills). */
  insufficientFitCase: boolean;
  /** Honest handling: NOT a confident apply/hold — hold recommendation AND low confidence. */
  insufficientFitHandled: boolean;

  thinCase: boolean;
  /** Thin handling: no forbidden inflation leaked AND confidence stayed appropriately low. */
  thinHandled: boolean;

  // ----- what the RAW model proposed (the guardrail corrected these) -----
  rawRecommendation: string | null;
  rawConfidence: number | null;
  /** Raw model recommendation differed from the final grounded one. */
  rawRecommendationChanged: boolean;
  /** Raw model confidence fell outside the golden band (guardrail re-derived it). */
  rawConfidenceOutsideBand: boolean;
  /** Raw evidence refs that do not resolve to a real fact (guardrail dropped them). */
  rawUngroundedEvidenceRefs: number;
  /** Forbidden inflation strings the RAW model emitted (guardrail scrubbed them). */
  rawForbiddenClaims: number;
  /** Total raw-proposal violations the deterministic guardrail caught for this sample. */
  guardrailCaught: number;

  /** FINAL-output fabrication leaks — MUST be empty (Sev-1 if not). */
  fabricationLeaks: string[];

  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  outputSignature: string;
  rawOutputSignature: string;
  parseValid: boolean;
}

export interface RealDecisionCaseResult {
  caseId: string;
  adversarial: boolean;
  insufficientFitCase: boolean;
  expectedLabel: ApplyHold;
  expectedConfidence: { min: number; max: number };
  samples: RealDecisionSample[];
  labelAccuracy: number;
  confidenceInBandRate: number;
  meanConfidence: number;
  confidenceStdDev: number;
  confidenceRange: number;
  insufficientFitHandled: number;
  thinHandled: number;
  guardrailCaught: number;
  samplesWithGuardrailCaught: number;
  fabricationLeaks: number;
  meanLatencyMs: number;
  latencyStdDevMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  meanInputTokens: number;
  inputTokensStdDev: number;
  meanOutputTokens: number;
  outputTokensStdDev: number;
  totalCostUsd: number;
  meanCostUsd: number;
  distinctFinalOutputs: number;
  distinctRawOutputs: number;
}

export interface RealDecisionCampaignResult {
  model: string;
  runsPerCase: number;
  caseCount: number;
  sampleCount: number;
  cases: RealDecisionCaseResult[];

  labelAccuracy: number;
  labelCorrectSamples: number;
  confidenceInBandRate: number;
  confidenceInBandSamples: number;

  // apply/hold confusion (over the apply/hold labels)
  applyExpectedSamples: number;
  holdExpectedSamples: number;
  applyCorrectSamples: number;
  holdCorrectSamples: number;

  insufficientFitSampleCount: number;
  insufficientFitHandledSamples: number;
  thinSampleCount: number;
  thinHandledSamples: number;

  // reliability / calibration (confidence contract → ECE computed)
  confidenceAvailableSamples: number;
  reliabilityBins: ReliabilityBin[];
  ece: number | null;
  meanConfidenceApply: number | null;
  meanConfidenceHold: number | null;

  guardrailCaught: number;
  rawRecommendationChanged: number;
  rawConfidenceOutsideBand: number;
  rawUngroundedEvidenceRefs: number;
  rawForbiddenClaims: number;
  samplesWithGuardrailCaught: number;
  fabricationLeaks: number;
  parseValidSamples: number;

  meanLatencyMs: number;
  latencyStdDevMs: number;
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

  meanConfidenceStdDev: number;
  casesWithVariableConfidence: number;
  casesWithVariableFinalOutput: number;
  casesWithVariableRawOutput: number;
}

// ---------- small numeric helpers (match the scoring/tailoring harnesses) ----------

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


// ---------- raw-proposal accounting ----------

function parseRaw(text: string): ReturnType<typeof rawDecisionProposalSchema.safeParse> {
  try {
    return rawDecisionProposalSchema.safeParse(JSON.parse(text) as unknown);
  } catch {
    return rawDecisionProposalSchema.safeParse(null);
  }
}

/** The set of evidence refs that resolve to a real profile/state fact. */
function realFactIds(c: DecisionCase): Set<string> {
  const ids = new Set<string>(c.profile.map((f) => f.id));
  for (const dim of c.stateModel) for (const ref of dim.evidenceRefs) ids.add(ref);
  return ids;
}

function finalSignature(produced: DecisionContract): string {
  return [
    produced.recommendation,
    produced.confidence.toFixed(3),
    [...produced.evidenceRefs].sort().join(','),
    norm(produced.reasoning),
    norm(produced.optionalityNote ?? ''),
  ].join('|');
}

function rawSignature(text: string): string {
  const parsed = parseRaw(text);
  if (!parsed.success) return `unparsed:${norm(text).slice(0, 200)}`;
  const p = parsed.data;
  return [
    norm(p.recommendation),
    p.confidence,
    [...p.evidenceRefs].sort().join(','),
    norm(p.reasoning),
  ].join('|');
}

// ---------- final-output fabrication leaks (must be zero) ----------

function finalLeaks(c: DecisionCase, produced: DecisionContract): string[] {
  const leaks = new Set<string>();
  const factIds = realFactIds(c);
  for (const ref of produced.evidenceRefs) {
    if (!factIds.has(ref)) leaks.add(`ungrounded-evidence:${ref || '(missing)'}`);
  }
  // Match the committed deterministic decision gate exactly: forbidden
  // inflation is scanned over the actual recommendation claim, not over the
  // optional next-step note. A note such as "revisit a Staff role later" is
  // honest gap handling, not a claim that the candidate is already Staff.
  const haystack = norm(`${produced.reasoning} ${produced.recommendation}`);
  for (const forbidden of c.forbidden ?? []) {
    if (haystack.includes(norm(forbidden))) leaks.add(`forbidden:${forbidden}`);
  }
  if (!(CANONICAL_ALTERNATIVES as readonly string[]).includes(produced.recommendation)) {
    leaks.add(`invalid-recommendation:${produced.recommendation || '(empty)'}`);
  }
  if (produced.confidence < 0 || produced.confidence > 1 || Number.isNaN(produced.confidence)) {
    leaks.add(`confidence-out-of-range:${produced.confidence}`);
  }
  return [...leaks];
}

export function scoreRealDecisionSample(input: {
  c: DecisionCase;
  run: number;
  rawText: string;
  produced: DecisionContract;
  response: RealCampaignResponse;
  latencyMs: number;
}): RealDecisionSample {
  const { c, produced } = input;
  const factIds = realFactIds(c);

  const expectedLabel = toApplyHold(c.expected.recommendation);
  const predictedLabel = toApplyHold(produced.recommendation);
  const labelCorrect = predictedLabel === expectedLabel;

  const band = c.expected.confidence;
  const confidenceInBand = produced.confidence >= band.min && produced.confidence <= band.max;

  const insufficientFitCase = INSUFFICIENT_FIT_CASE_IDS.has(c.id);
  const insufficientFitHandled =
    predictedLabel === 'hold' && produced.confidence <= INSUFFICIENT_FIT_CONFIDENCE_CEILING;

  const leaks = finalLeaks(c, produced);
  const thinCase = THIN_ADVERSARIAL_CASE_IDS.has(c.id);
  // Thin handling: no inflation leaked into the final AND confidence honoured its (low) band.
  const thinHandled = leaks.length === 0 && confidenceInBand;

  // ----- raw-proposal accounting (guardrail catch measurement) -----
  const parsed = parseRaw(input.rawText);
  const raw = parsed.success ? parsed.data : null;
  const rawRecommendation = raw ? raw.recommendation : null;
  const rawConfidence = raw ? raw.confidence : null;
  const rawRecommendationChanged =
    raw !== null && norm(raw.recommendation) !== norm(produced.recommendation);
  const rawConfidenceOutsideBand =
    raw !== null && (raw.confidence < band.min || raw.confidence > band.max);
  const rawUngroundedEvidenceRefs = raw
    ? raw.evidenceRefs.filter((ref) => !factIds.has(ref)).length
    : 0;
  const rawHaystack = raw ? norm(`${raw.reasoning} ${raw.recommendation}`) : '';
  const rawForbiddenClaims = raw
    ? (c.forbidden ?? []).filter((forbidden) => rawHaystack.includes(norm(forbidden))).length
    : 0;
  const guardrailCaught =
    (rawRecommendationChanged ? 1 : 0) +
    (rawConfidenceOutsideBand ? 1 : 0) +
    rawUngroundedEvidenceRefs +
    rawForbiddenClaims;

  return {
    run: input.run,
    recommendation: produced.recommendation,
    predictedLabel,
    expectedLabel,
    labelCorrect,
    confidenceAvailable: true,
    confidence: produced.confidence,
    confidenceInBand,
    insufficientFitCase,
    insufficientFitHandled,
    thinCase,
    thinHandled,
    rawRecommendation,
    rawConfidence,
    rawRecommendationChanged,
    rawConfidenceOutsideBand,
    rawUngroundedEvidenceRefs,
    rawForbiddenClaims,
    guardrailCaught,
    fabricationLeaks: leaks,
    latencyMs: input.latencyMs,
    inputTokens: input.response.usage.inputTokens,
    outputTokens: input.response.usage.outputTokens,
    costUsd: input.response.costUsd,
    outputSignature: finalSignature(produced),
    rawOutputSignature: rawSignature(input.rawText),
    parseValid: parsed.success,
  };
}


// ---------- reliability bins + ECE ----------

const BIN_EDGES: Array<{ label: string; min: number; max: number }> = [
  { label: '[0.0,0.2)', min: 0.0, max: 0.2 },
  { label: '[0.2,0.4)', min: 0.2, max: 0.4 },
  { label: '[0.4,0.6)', min: 0.4, max: 0.6 },
  { label: '[0.6,0.8)', min: 0.6, max: 0.8 },
  { label: '[0.8,1.0]', min: 0.8, max: 1.0 },
];

/**
 * Reliability bins over the final confidence. The correctness target is
 * recommendation-correctness (predicted apply/hold == golden expected), so
 * observedAccuracy is the fraction of correct decisions inside each bin.
 * ECE = Σ (n_bin / N) · |meanConfidence_bin − observedAccuracy_bin|.
 *
 * DIRECTIONAL at small N: because the guardrail deliberately caps confidence
 * low on thin/gap inputs (an anti-overconfidence honesty property), a strict
 * "confidence == P(recommendation correct)" ECE is inflated by design on the
 * hold cases — see the report for the fit-strength interpretation.
 */
export function reliabilityBinsAndEce(samples: RealDecisionSample[]): {
  bins: ReliabilityBin[];
  ece: number | null;
} {
  const withConfidence = samples.filter((s) => s.confidenceAvailable);
  if (withConfidence.length === 0) return { bins: [], ece: null };
  const bins: ReliabilityBin[] = BIN_EDGES.map((edge) => {
    const inBin = withConfidence.filter((s) => {
      const isLast = edge.max === 1.0;
      return s.confidence >= edge.min && (isLast ? s.confidence <= edge.max : s.confidence < edge.max);
    });
    return {
      label: edge.label,
      min: edge.min,
      max: edge.max,
      count: inBin.length,
      meanConfidence: inBin.length === 0 ? null : mean(inBin.map((s) => s.confidence)),
      observedAccuracy: inBin.length === 0 ? null : mean(inBin.map((s) => (s.labelCorrect ? 1 : 0))),
    };
  });
  const total = withConfidence.length;
  const ece = bins.reduce((sum, bin) => {
    if (bin.count === 0 || bin.meanConfidence === null || bin.observedAccuracy === null) return sum;
    return sum + (bin.count / total) * Math.abs(bin.meanConfidence - bin.observedAccuracy);
  }, 0);
  return { bins, ece };
}


// ---------- aggregation ----------

export function aggregateRealDecisionCampaign(
  model: string,
  byCase: Array<{ c: DecisionCase; samples: RealDecisionSample[] }>,
): RealDecisionCampaignResult {
  const cases: RealDecisionCaseResult[] = byCase.map(({ c, samples }) => {
    const confidences = samples.map((s) => s.confidence);
    const latencies = samples.map((s) => s.latencyMs);
    const costs = samples.map((s) => s.costUsd);
    const confMin = Math.min(...confidences);
    const confMax = Math.max(...confidences);
    return {
      caseId: c.id,
      adversarial: c.adversarial === true,
      insufficientFitCase: INSUFFICIENT_FIT_CASE_IDS.has(c.id),
      expectedLabel: toApplyHold(c.expected.recommendation),
      expectedConfidence: { min: c.expected.confidence.min, max: c.expected.confidence.max },
      samples,
      labelAccuracy: mean(samples.map((s) => (s.labelCorrect ? 1 : 0))),
      confidenceInBandRate: mean(samples.map((s) => (s.confidenceInBand ? 1 : 0))),
      meanConfidence: mean(confidences),
      confidenceStdDev: standardDeviation(confidences),
      confidenceRange: confMax - confMin,
      insufficientFitHandled: samples.filter((s) => s.insufficientFitCase && s.insufficientFitHandled).length,
      thinHandled: samples.filter((s) => s.thinCase && s.thinHandled).length,
      guardrailCaught: samples.reduce((sum, s) => sum + s.guardrailCaught, 0),
      samplesWithGuardrailCaught: samples.filter((s) => s.guardrailCaught > 0).length,
      fabricationLeaks: samples.reduce((sum, s) => sum + s.fabricationLeaks.length, 0),
      meanLatencyMs: mean(latencies),
      latencyStdDevMs: standardDeviation(latencies),
      totalInputTokens: samples.reduce((sum, s) => sum + s.inputTokens, 0),
      totalOutputTokens: samples.reduce((sum, s) => sum + s.outputTokens, 0),
      meanInputTokens: mean(samples.map((s) => s.inputTokens)),
      inputTokensStdDev: standardDeviation(samples.map((s) => s.inputTokens)),
      meanOutputTokens: mean(samples.map((s) => s.outputTokens)),
      outputTokensStdDev: standardDeviation(samples.map((s) => s.outputTokens)),
      totalCostUsd: costs.reduce((sum, cost) => sum + cost, 0),
      meanCostUsd: mean(costs),
      distinctFinalOutputs: new Set(samples.map((s) => s.outputSignature)).size,
      distinctRawOutputs: new Set(samples.map((s) => s.rawOutputSignature)).size,
    };
  });

  const samples = cases.flatMap((result) => result.samples);
  const latencies = samples.map((s) => s.latencyMs);
  const costs = samples.map((s) => s.costUsd);

  const applyExpected = samples.filter((s) => s.expectedLabel === 'apply');
  const holdExpected = samples.filter((s) => s.expectedLabel === 'hold');
  const insufficientFitSamples = samples.filter((s) => s.insufficientFitCase);
  const thinSamples = samples.filter((s) => s.thinCase);
  const applyConf = applyExpected.map((s) => s.confidence);
  const holdConf = holdExpected.map((s) => s.confidence);

  const { bins, ece } = reliabilityBinsAndEce(samples);

  return {
    model,
    runsPerCase: REAL_DECISION_RUNS_PER_CASE,
    caseCount: cases.length,
    sampleCount: samples.length,
    cases,
    labelAccuracy: mean(samples.map((s) => (s.labelCorrect ? 1 : 0))),
    labelCorrectSamples: samples.filter((s) => s.labelCorrect).length,
    confidenceInBandRate: mean(samples.map((s) => (s.confidenceInBand ? 1 : 0))),
    confidenceInBandSamples: samples.filter((s) => s.confidenceInBand).length,
    applyExpectedSamples: applyExpected.length,
    holdExpectedSamples: holdExpected.length,
    applyCorrectSamples: applyExpected.filter((s) => s.labelCorrect).length,
    holdCorrectSamples: holdExpected.filter((s) => s.labelCorrect).length,
    insufficientFitSampleCount: insufficientFitSamples.length,
    insufficientFitHandledSamples: insufficientFitSamples.filter((s) => s.insufficientFitHandled).length,
    thinSampleCount: thinSamples.length,
    thinHandledSamples: thinSamples.filter((s) => s.thinHandled).length,
    confidenceAvailableSamples: samples.filter((s) => s.confidenceAvailable).length,
    reliabilityBins: bins,
    ece,
    meanConfidenceApply: applyConf.length === 0 ? null : mean(applyConf),
    meanConfidenceHold: holdConf.length === 0 ? null : mean(holdConf),
    guardrailCaught: samples.reduce((sum, s) => sum + s.guardrailCaught, 0),
    rawRecommendationChanged: samples.filter((s) => s.rawRecommendationChanged).length,
    rawConfidenceOutsideBand: samples.filter((s) => s.rawConfidenceOutsideBand).length,
    rawUngroundedEvidenceRefs: samples.reduce((sum, s) => sum + s.rawUngroundedEvidenceRefs, 0),
    rawForbiddenClaims: samples.reduce((sum, s) => sum + s.rawForbiddenClaims, 0),
    samplesWithGuardrailCaught: samples.filter((s) => s.guardrailCaught > 0).length,
    fabricationLeaks: samples.reduce((sum, s) => sum + s.fabricationLeaks.length, 0),
    parseValidSamples: samples.filter((s) => s.parseValid).length,
    meanLatencyMs: mean(latencies),
    latencyStdDevMs: standardDeviation(latencies),
    p95LatencyMs: percentile95(latencies),
    totalInputTokens: samples.reduce((sum, s) => sum + s.inputTokens, 0),
    totalOutputTokens: samples.reduce((sum, s) => sum + s.outputTokens, 0),
    meanInputTokens: mean(samples.map((s) => s.inputTokens)),
    inputTokensStdDev: standardDeviation(samples.map((s) => s.inputTokens)),
    meanOutputTokens: mean(samples.map((s) => s.outputTokens)),
    outputTokensStdDev: standardDeviation(samples.map((s) => s.outputTokens)),
    totalCostUsd: costs.reduce((sum, cost) => sum + cost, 0),
    meanCostUsd: mean(costs),
    costStdDevUsd: standardDeviation(costs),
    meanConfidenceStdDev: mean(cases.map((result) => result.confidenceStdDev)),
    casesWithVariableConfidence: cases.filter((result) => result.confidenceRange > 0).length,
    casesWithVariableFinalOutput: cases.filter((result) => result.distinctFinalOutputs > 1).length,
    casesWithVariableRawOutput: cases.filter((result) => result.distinctRawOutputs > 1).length,
  };
}


export function formatRealDecisionCampaign(result: RealDecisionCampaignResult): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const rows = result.cases.map((c) => {
    const finals = c.samples
      .map((s) => `${s.predictedLabel}@${s.confidence.toFixed(2)}`)
      .join(' / ');
    return `| ${c.caseId} | ${c.expectedLabel} (${c.expectedConfidence.min}–${c.expectedConfidence.max}) | ${finals} | ${percent(c.labelAccuracy)} | ${percent(c.confidenceInBandRate)} | ${c.guardrailCaught} (${c.samplesWithGuardrailCaught}/3) | ${c.fabricationLeaks} | ${Math.round(c.meanLatencyMs)} ± ${Math.round(c.latencyStdDevMs)} | ${Math.round(c.meanInputTokens)} / ${Math.round(c.meanOutputTokens)} | $${c.totalCostUsd.toFixed(6)} | ${c.distinctRawOutputs}/3 |`;
  });
  const binLines = result.reliabilityBins
    .filter((bin) => bin.count > 0)
    .map(
      (bin) =>
        `  ${bin.label}: n=${bin.count}; mean conf ${(bin.meanConfidence ?? 0).toFixed(3)}; observed acc ${((bin.observedAccuracy ?? 0) * 100).toFixed(1)}%`,
    );
  return [
    `Model: ${result.model}`,
    `Samples: ${result.sampleCount} (${result.caseCount} cases × ${result.runsPerCase})`,
    `Contract type: GROUNDED + CALIBRATED CONFIDENCE (numeric confidence present → ECE computed)`,
    `Recommendation accuracy (apply/hold): ${percent(result.labelAccuracy)} (${result.labelCorrectSamples}/${result.sampleCount})`,
    `  apply: ${result.applyCorrectSamples}/${result.applyExpectedSamples}; hold: ${result.holdCorrectSamples}/${result.holdExpectedSamples}`,
    `Confidence-in-band: ${percent(result.confidenceInBandRate)} (${result.confidenceInBandSamples}/${result.sampleCount})`,
    `Insufficient-fit handling: ${result.insufficientFitHandledSamples}/${result.insufficientFitSampleCount} honest (hold + conf ≤ ${INSUFFICIENT_FIT_CONFIDENCE_CEILING})`,
    `Thin/adversarial handling: ${result.thinHandledSamples}/${result.thinSampleCount}`,
    `Fabrication leaks: ${result.fabricationLeaks}`,
    `Reliability / ECE (directional, N=${result.sampleCount}): ECE ${result.ece === null ? 'N/A' : result.ece.toFixed(3)}`,
    ...binLines,
    `  mean conf on apply-cases ${result.meanConfidenceApply === null ? 'n/a' : result.meanConfidenceApply.toFixed(3)}; on hold-cases ${result.meanConfidenceHold === null ? 'n/a' : result.meanConfidenceHold.toFixed(3)}`,
    `Guardrail caught: ${result.guardrailCaught} across ${result.samplesWithGuardrailCaught}/${result.sampleCount} samples`,
    `  by type — recommendation-changed: ${result.rawRecommendationChanged}; confidence-out-of-band: ${result.rawConfidenceOutsideBand}; ungrounded-evidence: ${result.rawUngroundedEvidenceRefs}; forbidden-claims: ${result.rawForbiddenClaims}`,
    `Latency: mean ${Math.round(result.meanLatencyMs)} ms; σ ${Math.round(result.latencyStdDevMs)} ms; p95 ${Math.round(result.p95LatencyMs)} ms`,
    `Tokens: ${result.totalInputTokens} input; ${result.totalOutputTokens} output`,
    `Cost: $${result.totalCostUsd.toFixed(6)}`,
    `Confidence variance: mean per-case σ ${result.meanConfidenceStdDev.toFixed(3)}; ${result.casesWithVariableConfidence}/${result.caseCount} cases varied`,
    `Final-output variance: ${result.casesWithVariableFinalOutput}/${result.caseCount} cases varied`,
    `Raw-output variance: ${result.casesWithVariableRawOutput}/${result.caseCount} cases varied`,
    '',
    '| Case | Expected (band) | Predicted@conf 1/2/3 | Rec accuracy | Conf in-band | Catches | Leaks | Mean ± σ ms | Mean tokens in/out | Cost | Distinct raw |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}
