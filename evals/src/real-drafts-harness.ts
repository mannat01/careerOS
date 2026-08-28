/** Track B Slice 8 — real-model drafts measurement and independent integrity oracle. */
import { createHash } from 'node:crypto';
import {
  groundDraft,
  parseDraftProposal,
  type Draft,
  type DraftClaim,
  type DraftProposal,
} from '@careeros/cie-drafting';
import { isTextGrounded } from '@careeros/cie-resume';
import type { DraftResponse } from '../../packages/contracts/src/draft.js';
import type { RealDraftCase } from '../drafting/real-cases.js';
import type { RealCampaignResponse } from './real-campaign-runtime.js';

export const REAL_DRAFT_RUNS_PER_CASE = 3;

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

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function includesInsensitive(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

function parseJson(rawText: string): unknown {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rawParseValid(value: unknown): boolean {
  if (!isRecord(value) || typeof value.subject !== 'string' || typeof value.body !== 'string') return false;
  if (!Array.isArray(value.claims)) return false;
  return value.claims.every((claim) =>
    isRecord(claim) && typeof claim.claim === 'string' && typeof claim.factRef === 'string');
}

function finalSurface(output: DraftResponse): string {
  if (output.status === 'insufficient_data') return JSON.stringify(output);
  return [output.subject, output.body, ...output.claims.map((claim) => claim.claim)].join('\n');
}

function finalFactualSurface(output: DraftResponse): string {
  if (output.status === 'insufficient_data') return '';
  const bodyClaims = output.body.split(/\r?\n/).filter((line) => /^\s*-\s*/.test(line));
  return [...bodyClaims, ...output.claims.map((claim) => claim.claim)].join('\n');
}

function finalSignature(output: DraftResponse): string {
  if (output.status === 'insufficient_data') return digest(JSON.stringify(output));
  return digest(JSON.stringify({
    kind: output.kind,
    recipient: output.recipient,
    subject: output.subject,
    body: output.body,
    claims: output.claims,
    modelVersion: output.modelVersion,
    status: output.status,
  }));
}

function rawSurface(proposal: DraftProposal): string {
  return [proposal.subject, proposal.body, ...proposal.claims.map((claim) => claim.claim)].join('\n');
}

function draftFromOutput(output: DraftResponse): Draft | null {
  if (output.status === 'insufficient_data') return null;
  return {
    kind: output.kind,
    subject: output.subject,
    body: output.body,
    claims: output.claims,
    modelVersion: output.modelVersion,
  };
}

function sameDraft(left: Draft, right: Draft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function finalClaimSupported(claim: DraftClaim, summary: string): boolean {
  // Production recompute renders `For "requirement": ${fact.summary}`. Requiring
  // the exact source summary suffix catches a valid-ref/embellished-text bypass.
  return normalize(claim.claim).endsWith(normalize(summary));
}

interface RawInspection {
  parseValid: boolean;
  proposal: DraftProposal;
  structuralCatches: number;
  semanticCatches: number;
  forbiddenCatches: number;
  malformedCatches: number;
  eligibleClaimCount: number;
  verbatimClaimCount: number;
  rawQualityOk: boolean;
}

function inspectRaw(c: RealDraftCase, rawText: string): RawInspection {
  const value = parseJson(rawText);
  const parseValid = rawParseValid(value);
  const proposal = parseDraftProposal(rawText);
  const profileById = new Map(c.input.profile.map((fact) => [fact.id, fact]));
  const allowed = new Set(c.input.allowedFactRefs);
  const structuralCatches = proposal.claims.filter((claim) =>
    !allowed.has(claim.factRef) || !profileById.has(claim.factRef)).length;
  const eligibleClaims = proposal.claims.filter((claim) => profileById.has(claim.factRef));
  const semanticCatches = eligibleClaims.filter((claim) => {
    const fact = profileById.get(claim.factRef);
    return fact === undefined ||
      (!isTextGrounded(claim.claim, fact) && !finalClaimSupported(claim, fact.summary));
  }).length;
  const forbiddenCatches = c.forbiddenClaims.filter((forbidden) =>
    includesInsensitive(rawSurface(proposal), forbidden)).length;
  const malformedCatches = Number(!parseValid) +
    Number(proposal.subject.trim().length === 0) +
    Number(proposal.body.trim().length === 0);
  const rawRefs = new Set(eligibleClaims.map((claim) => claim.factRef));
  const expectedRefsCovered = c.expectedFactRefs.every((ref) => rawRefs.has(ref));
  const expectedTermsCovered = c.expectedTerms.every((term) => includesInsensitive(rawSurface(proposal), term));
  return {
    parseValid,
    proposal,
    structuralCatches,
    semanticCatches,
    forbiddenCatches,
    malformedCatches,
    eligibleClaimCount: eligibleClaims.length,
    verbatimClaimCount: eligibleClaims.filter((claim) => {
      const fact = profileById.get(claim.factRef);
      return fact !== undefined && normalize(claim.claim) === normalize(fact.summary);
    }).length,
    rawQualityOk: parseValid && proposal.subject.trim().length > 0 && proposal.body.trim().length > 0 &&
      expectedRefsCovered && expectedTermsCovered,
  };
}

export interface RealDraftSample {
  run: number;
  kind: RealDraftCase['kind'];
  adversarial: boolean;
  thinCase: boolean;
  status: DraftResponse['status'];
  finalClaimCount: number;
  groundedFinalClaims: number;
  groundingFidelity: number;
  fabricationLeaks: string[];
  qualityCoherent: boolean;
  thinCorrectNoFiller: boolean;
  groundableDraftReturned: boolean;
  parseValid: boolean;
  rawQualityOk: boolean;
  eligibleRawClaims: number;
  survivedModelClaims: number;
  replacedModelClaims: number;
  verbatimRawClaims: number;
  proseSurvivalRate: number;
  proseReplacementRate: number;
  structuralCatches: number;
  semanticCatches: number;
  forbiddenCatches: number;
  malformedCatches: number;
  rawQualityMisses: number;
  guardrailCaught: number;
  guardrailAffected: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  finalOutputSignature: string;
  rawOutputSignature: string;
}

export function scoreRealDraftSample(input: {
  c: RealDraftCase;
  run: number;
  rawText: string;
  output: DraftResponse;
  response: RealCampaignResponse;
  latencyMs: number;
}): RealDraftSample {
  const { c, output } = input;
  const raw = inspectRaw(c, input.rawText);
  // DraftingService assembles this exact agent input and intentionally does not
  // propagate eval-only `forbiddenClaims`. Mirror the production path when
  // independently recomputing the expected guard output.
  const { forbiddenClaims: _evalOnlyForbiddenClaims, ...productionInput } = c.input;
  const profileById = new Map(c.input.profile.map((fact) => [fact.id, fact]));
  const outputDraft = draftFromOutput(output);
  const finalClaims = outputDraft?.claims ?? [];
  const groundedFinalClaims = finalClaims.filter((claim) => {
    const fact = profileById.get(claim.factRef);
    return fact !== undefined && finalClaimSupported(claim, fact.summary) &&
      outputDraft?.body.split(/\r?\n/).some((line) => normalize(line.replace(/^\s*-\s*/, '')) === normalize(claim.claim));
  }).length;
  const expected = groundDraft(productionInput, raw.proposal).draft;
  const leaks: string[] = [];
  if (output.status === 'draft' && !sameDraft(expected, outputDraft!)) leaks.push('guardrail-recompute-mismatch');
  if (output.status === 'insufficient_data' && expected.claims.length > 0) leaks.push('grounded-draft-discarded');
  for (const claim of finalClaims) {
    const fact = profileById.get(claim.factRef);
    if (!fact) leaks.push(`unresolved-final-factRef:${claim.factRef}`);
    else if (!finalClaimSupported(claim, fact.summary)) leaks.push(`embellished-final-claim:${claim.factRef}`);
  }
  const bodyBullets = outputDraft?.body.split(/\r?\n/)
    .filter((line) => /^\s*-\s*/.test(line))
    .map((line) => normalize(line.replace(/^\s*-\s*/, ''))) ?? [];
  const claimTexts = new Set(finalClaims.map((claim) => normalize(claim.claim)));
  for (const bullet of bodyBullets) {
    if (!claimTexts.has(bullet)) leaks.push(`orphan-final-body-claim:${bullet}`);
  }
  for (const forbidden of c.forbiddenClaims) {
    // Unsupported opportunity requirements may appear in the guard's explicit
    // interest-to-grow sentence. They are leaks only when asserted as factual
    // body bullets / claims.
    if (includesInsensitive(finalFactualSurface(output), forbidden)) {
      leaks.push(`forbidden-final-claim:${forbidden}`);
    }
  }
  const exactThinShape = output.status === 'insufficient_data' &&
    JSON.stringify(output) === JSON.stringify({ status: 'insufficient_data' });
  const thinCorrectNoFiller = !c.thinInsufficientData || exactThinShape;
  const expectedRefs = new Set(c.expectedFactRefs);
  const finalRefs = new Set(finalClaims.map((claim) => claim.factRef));
  const expectedRefsCovered = [...expectedRefs].every((ref) => finalRefs.has(ref));
  const expectedTermsCovered = c.expectedTerms.every((term) => includesInsensitive(finalSurface(output), term));
  const greetingOk = outputDraft === null || outputDraft.body.startsWith(c.input.recipient?.name
    ? `Hi ${c.input.recipient.name},`
    : 'Hello,');
  const qualityCoherent = c.thinInsufficientData
    ? exactThinShape
    : output.status === 'draft' && finalClaims.length > 0 && expectedRefsCovered && expectedTermsCovered &&
      greetingOk && output.body.includes('Thank you for your consideration.');
  const survivedModelClaims = outputDraft === null ? 0 : raw.proposal.claims.filter((claim) =>
    profileById.has(claim.factRef) && outputDraft.claims.some((finalClaim) =>
      finalClaim.factRef === claim.factRef && normalize(finalClaim.claim) === normalize(claim.claim)) &&
    outputDraft.body.split(/\r?\n/).some((line) => normalize(line.replace(/^\s*-\s*/, '')) === normalize(claim.claim))).length;
  const replacedModelClaims = Math.max(0, raw.eligibleClaimCount - survivedModelClaims);
  const guardrailCaught = raw.structuralCatches + raw.semanticCatches + raw.forbiddenCatches +
    raw.malformedCatches + replacedModelClaims + Number(!raw.rawQualityOk && !c.thinInsufficientData);
  return {
    run: input.run,
    kind: c.kind,
    adversarial: c.adversarial,
    thinCase: c.thinInsufficientData,
    status: output.status,
    finalClaimCount: finalClaims.length,
    groundedFinalClaims,
    groundingFidelity: finalClaims.length === 0 ? 1 : groundedFinalClaims / finalClaims.length,
    fabricationLeaks: [...new Set(leaks)],
    qualityCoherent,
    thinCorrectNoFiller,
    groundableDraftReturned: !c.thinInsufficientData && output.status === 'draft',
    parseValid: raw.parseValid,
    rawQualityOk: raw.rawQualityOk,
    eligibleRawClaims: raw.eligibleClaimCount,
    survivedModelClaims,
    replacedModelClaims,
    verbatimRawClaims: raw.verbatimClaimCount,
    proseSurvivalRate: raw.eligibleClaimCount === 0 ? 0 : survivedModelClaims / raw.eligibleClaimCount,
    proseReplacementRate: raw.eligibleClaimCount === 0 ? 0 : replacedModelClaims / raw.eligibleClaimCount,
    structuralCatches: raw.structuralCatches,
    semanticCatches: raw.semanticCatches,
    forbiddenCatches: raw.forbiddenCatches,
    malformedCatches: raw.malformedCatches,
    rawQualityMisses: Number(!raw.rawQualityOk && !c.thinInsufficientData),
    guardrailCaught,
    guardrailAffected: guardrailCaught > 0,
    latencyMs: input.latencyMs,
    inputTokens: input.response.usage.inputTokens,
    outputTokens: input.response.usage.outputTokens,
    costUsd: input.response.costUsd,
    finalOutputSignature: finalSignature(output),
    rawOutputSignature: digest(input.rawText),
  };
}

export interface RealDraftCaseResult {
  caseId: string;
  kind: RealDraftCase['kind'];
  adversarial: boolean;
  thinCase: boolean;
  samples: RealDraftSample[];
  qualityPasses: number;
  fabricationLeaks: number;
  guardrailCaught: number;
  guardrailAffectedSamples: number;
  meanLatencyMs: number;
  latencyStdDevMs: number;
  meanInputTokens: number;
  meanOutputTokens: number;
  totalCostUsd: number;
  distinctFinalOutputs: number;
  distinctRawOutputs: number;
}

export interface RealDraftCampaignResult {
  model: string;
  runsPerCase: number;
  caseCount: number;
  sampleCount: number;
  paidCompletionCount: number;
  cases: RealDraftCaseResult[];
  contractType: 'grounded-generation';
  confidence: 'not-present';
  ece: null;
  coverLetterSamples: number;
  outreachSamples: number;
  coverLetterDrafts: number;
  outreachDrafts: number;
  fabricationLeaks: number;
  groundingFidelity: number;
  qualityCoherenceRate: number;
  thinSampleCount: number;
  thinCorrectNoFiller: number;
  groundableSampleCount: number;
  groundableDrafts: number;
  groundableDraftRate: number;
  insufficientDataCount: number;
  insufficientDataRate: number;
  parseValidSamples: number;
  rawQualityPasses: number;
  eligibleRawClaims: number;
  survivedModelClaims: number;
  replacedModelClaims: number;
  verbatimRawClaims: number;
  proseSurvivalRate: number;
  proseReplacementRate: number;
  structuralCatches: number;
  semanticCatches: number;
  forbiddenCatches: number;
  malformedCatches: number;
  rawQualityMisses: number;
  guardrailCaught: number;
  guardrailAffectedSamples: number;
  guardrailAffectedRate: number;
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
  casesWithVariableFinalOutput: number;
  casesWithVariableRawOutput: number;
  verdict: 'GREEN' | 'YELLOW' | 'RED';
  verdictReasons: string[];
}

export function aggregateRealDraftCampaign(
  model: string,
  byCase: Array<{ c: RealDraftCase; samples: RealDraftSample[] }>,
): RealDraftCampaignResult {
  const samples = byCase.flatMap(({ samples: caseSamples }) => caseSamples);
  const cases = byCase.map(({ c, samples: caseSamples }): RealDraftCaseResult => ({
    caseId: c.id,
    kind: c.kind,
    adversarial: c.adversarial,
    thinCase: c.thinInsufficientData,
    samples: caseSamples,
    qualityPasses: caseSamples.filter((sample) => sample.qualityCoherent).length,
    fabricationLeaks: caseSamples.reduce((sum, sample) => sum + sample.fabricationLeaks.length, 0),
    guardrailCaught: caseSamples.reduce((sum, sample) => sum + sample.guardrailCaught, 0),
    guardrailAffectedSamples: caseSamples.filter((sample) => sample.guardrailAffected).length,
    meanLatencyMs: mean(caseSamples.map((sample) => sample.latencyMs)),
    latencyStdDevMs: standardDeviation(caseSamples.map((sample) => sample.latencyMs)),
    meanInputTokens: mean(caseSamples.map((sample) => sample.inputTokens)),
    meanOutputTokens: mean(caseSamples.map((sample) => sample.outputTokens)),
    totalCostUsd: caseSamples.reduce((sum, sample) => sum + sample.costUsd, 0),
    distinctFinalOutputs: new Set(caseSamples.map((sample) => sample.finalOutputSignature)).size,
    distinctRawOutputs: new Set(caseSamples.map((sample) => sample.rawOutputSignature)).size,
  }));
  const finalClaimCount = samples.reduce((sum, sample) => sum + sample.finalClaimCount, 0);
  const groundedFinalClaims = samples.reduce((sum, sample) => sum + sample.groundedFinalClaims, 0);
  const fabricationLeaks = samples.reduce((sum, sample) => sum + sample.fabricationLeaks.length, 0);
  const thinSamples = samples.filter((sample) => sample.thinCase);
  const groundableSamples = samples.filter((sample) => !sample.thinCase);
  const eligibleRawClaims = samples.reduce((sum, sample) => sum + sample.eligibleRawClaims, 0);
  const survivedModelClaims = samples.reduce((sum, sample) => sum + sample.survivedModelClaims, 0);
  const replacedModelClaims = samples.reduce((sum, sample) => sum + sample.replacedModelClaims, 0);
  const guardrailAffectedSamples = samples.filter((sample) => sample.guardrailAffected).length;
  const coverLetterSamples = samples.filter((sample) => sample.kind === 'cover_letter').length;
  const outreachSamples = samples.filter((sample) => sample.kind === 'outreach').length;
  const coverLetterDrafts = samples.filter((sample) => sample.kind === 'cover_letter' && sample.status === 'draft').length;
  const outreachDrafts = samples.filter((sample) => sample.kind === 'outreach' && sample.status === 'draft').length;
  const thinCorrectNoFiller = thinSamples.filter((sample) => sample.thinCorrectNoFiller).length;
  const groundableDrafts = groundableSamples.filter((sample) => sample.groundableDraftReturned).length;
  const qualityCoherenceRate = mean(samples.map((sample) => Number(sample.qualityCoherent)));
  const groundingFidelity = finalClaimCount === 0 ? 1 : groundedFinalClaims / finalClaimCount;
  const verdictReasons: string[] = [];
  let verdict: RealDraftCampaignResult['verdict'] = 'GREEN';
  if (fabricationLeaks > 0) {
    verdict = 'RED';
    verdictReasons.push('one or more ungrounded or embellished claims leaked into a final body (Sev-1)');
  } else {
    if (groundingFidelity < 1) verdictReasons.push('final body grounding fidelity was below 100%');
    if (thinCorrectNoFiller !== thinSamples.length) verdictReasons.push('thin case emitted filler or failed insufficient_data');
    if (groundableDrafts !== groundableSamples.length) verdictReasons.push('a groundable case fell back to insufficient_data');
    if (coverLetterDrafts === 0 || outreachDrafts === 0) verdictReasons.push('both draft kinds did not produce a real draft');
    if (qualityCoherenceRate < 1) verdictReasons.push('one or more final drafts missed frozen quality/coherence expectations');
    if (eligibleRawClaims > 0 && replacedModelClaims / eligibleRawClaims > 0.75) {
      verdictReasons.push('heavy model-prose replacement (>75% of eligible raw claims): abstractive-prose tension');
    }
    if (samples.length > 0 && guardrailAffectedSamples / samples.length > 0.25) {
      verdictReasons.push('guardrail constantly masked raw-model defects (>25% of samples)');
    }
    if (verdictReasons.length > 0) verdict = 'YELLOW';
  }
  const latencies = samples.map((sample) => sample.latencyMs);
  const inputTokens = samples.map((sample) => sample.inputTokens);
  const outputTokens = samples.map((sample) => sample.outputTokens);
  const costs = samples.map((sample) => sample.costUsd);
  return {
    model,
    runsPerCase: REAL_DRAFT_RUNS_PER_CASE,
    caseCount: byCase.length,
    sampleCount: samples.length,
    paidCompletionCount: samples.length,
    cases,
    contractType: 'grounded-generation',
    confidence: 'not-present',
    ece: null,
    coverLetterSamples,
    outreachSamples,
    coverLetterDrafts,
    outreachDrafts,
    fabricationLeaks,
    groundingFidelity,
    qualityCoherenceRate,
    thinSampleCount: thinSamples.length,
    thinCorrectNoFiller,
    groundableSampleCount: groundableSamples.length,
    groundableDrafts,
    groundableDraftRate: groundableSamples.length === 0 ? 1 : groundableDrafts / groundableSamples.length,
    insufficientDataCount: samples.filter((sample) => sample.status === 'insufficient_data').length,
    insufficientDataRate: samples.length === 0 ? 0 : samples.filter((sample) => sample.status === 'insufficient_data').length / samples.length,
    parseValidSamples: samples.filter((sample) => sample.parseValid).length,
    rawQualityPasses: samples.filter((sample) => sample.rawQualityOk).length,
    eligibleRawClaims,
    survivedModelClaims,
    replacedModelClaims,
    verbatimRawClaims: samples.reduce((sum, sample) => sum + sample.verbatimRawClaims, 0),
    proseSurvivalRate: eligibleRawClaims === 0 ? 0 : survivedModelClaims / eligibleRawClaims,
    proseReplacementRate: eligibleRawClaims === 0 ? 0 : replacedModelClaims / eligibleRawClaims,
    structuralCatches: samples.reduce((sum, sample) => sum + sample.structuralCatches, 0),
    semanticCatches: samples.reduce((sum, sample) => sum + sample.semanticCatches, 0),
    forbiddenCatches: samples.reduce((sum, sample) => sum + sample.forbiddenCatches, 0),
    malformedCatches: samples.reduce((sum, sample) => sum + sample.malformedCatches, 0),
    rawQualityMisses: samples.reduce((sum, sample) => sum + sample.rawQualityMisses, 0),
    guardrailCaught: samples.reduce((sum, sample) => sum + sample.guardrailCaught, 0),
    guardrailAffectedSamples,
    guardrailAffectedRate: samples.length === 0 ? 0 : guardrailAffectedSamples / samples.length,
    meanLatencyMs: mean(latencies),
    latencyStdDevMs: standardDeviation(latencies),
    p95LatencyMs: percentile95(latencies),
    totalInputTokens: inputTokens.reduce((sum, value) => sum + value, 0),
    totalOutputTokens: outputTokens.reduce((sum, value) => sum + value, 0),
    meanInputTokens: mean(inputTokens),
    inputTokensStdDev: standardDeviation(inputTokens),
    meanOutputTokens: mean(outputTokens),
    outputTokensStdDev: standardDeviation(outputTokens),
    totalCostUsd: costs.reduce((sum, value) => sum + value, 0),
    meanCostUsd: mean(costs),
    costStdDevUsd: standardDeviation(costs),
    casesWithVariableFinalOutput: cases.filter((result) => result.distinctFinalOutputs > 1).length,
    casesWithVariableRawOutput: cases.filter((result) => result.distinctRawOutputs > 1).length,
    verdict,
    verdictReasons,
  };
}

export function formatRealDraftCampaign(result: RealDraftCampaignResult): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const rows = result.cases.map((c) =>
    `| ${c.caseId} | ${c.kind} | ${c.qualityPasses}/${c.samples.length} | ${c.samples.filter((s) => s.status === 'draft').length}/${c.samples.length} | ${c.fabricationLeaks} | ${c.guardrailCaught} (${c.guardrailAffectedSamples}/${c.samples.length}) | ${Math.round(c.meanLatencyMs)} ± ${Math.round(c.latencyStdDevMs)} | ${Math.round(c.meanInputTokens)} / ${Math.round(c.meanOutputTokens)} | $${c.totalCostUsd.toFixed(6)} | ${c.distinctRawOutputs}/${c.samples.length} |`);
  return [
    `Model: ${result.model}`,
    `Samples: ${result.sampleCount} (${result.caseCount} cases × ${result.runsPerCase}); paid completions ${result.paidCompletionCount}`,
    `Contract: grounded generation; confidence/ECE: N/A (no confidence field)`,
    `Verdict: ${result.verdict} — ${result.verdictReasons.join('; ') || 'all GREEN criteria met'}`,
    `Fabrication leaks: ${result.fabricationLeaks} ← MUST be 0`,
    `Final body grounding fidelity: ${percent(result.groundingFidelity)}`,
    `Quality/coherence: ${percent(result.qualityCoherenceRate)}`,
    `Both kinds: cover_letter ${result.coverLetterDrafts}/${result.coverLetterSamples}; outreach ${result.outreachDrafts}/${result.outreachSamples}`,
    `Thin insufficient_data without filler: ${result.thinCorrectNoFiller}/${result.thinSampleCount}`,
    `Groundable draft survival: ${result.groundableDrafts}/${result.groundableSampleCount} (${percent(result.groundableDraftRate)}); public insufficient_data ${result.insufficientDataCount}/${result.sampleCount} (${percent(result.insufficientDataRate)})`,
    `Literal substantive model-claim prose survival: ${result.survivedModelClaims}/${result.eligibleRawClaims} (${percent(result.proseSurvivalRate)}); deterministic replacement ${result.replacedModelClaims}/${result.eligibleRawClaims} (${percent(result.proseReplacementRate)}); verbatim raw ${result.verbatimRawClaims}`,
    `Guardrail caught: ${result.guardrailCaught} observations across ${result.guardrailAffectedSamples}/${result.sampleCount} samples (${percent(result.guardrailAffectedRate)})`,
    `  by type — structural refs: ${result.structuralCatches}; semantic embellishments: ${result.semanticCatches}; forbidden surfaces: ${result.forbiddenCatches}; malformed/fail-closed: ${result.malformedCatches}; deterministic claim replacements: ${result.replacedModelClaims}; raw quality misses: ${result.rawQualityMisses}`,
    `Latency: mean ${Math.round(result.meanLatencyMs)} ms; σ ${Math.round(result.latencyStdDevMs)} ms; p95 ${Math.round(result.p95LatencyMs)} ms`,
    `Tokens: ${result.totalInputTokens} input; ${result.totalOutputTokens} output`,
    `Cost: $${result.totalCostUsd.toFixed(6)} (mean $${result.meanCostUsd.toFixed(6)}/sample)`,
    `Final-output variance: ${result.casesWithVariableFinalOutput}/${result.caseCount} cases varied`,
    `Raw-output variance: ${result.casesWithVariableRawOutput}/${result.caseCount} cases varied`,
    '',
    '| Case | Kind | Quality | Draft | Leaks | Catches | Mean ± σ ms | Mean tokens in/out | Cost | Distinct raw |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}
