/**
 * Real-model RESEARCH-SYNTHESIZER measurement harness — Track B Slice 6.
 *
 * Production contract: supplied ResearchFinding[] + supplied allowedSources[] +
 * user context -> findings/citations grounded by `groundResearchSynthesis`.
 * The agent does not fetch or scrape; source acquisition is an upstream,
 * SourceRegistry/GuardedFetch concern. The final proposal is recomputed from the
 * supplied content, while this harness records raw-model defects the guardrail
 * masks and independently checks the shipped synthesis.
 *
 * `confidence` is a deterministic evidence-strength cap (weak=.5,
 * medium=.75, strong=1), not P(finding correct). ECE is therefore N/A.
 */
import {
  DEFAULT_CONFIDENCE_CAP,
  RESEARCH_INSUFFICIENT_DATA_REASON,
  groundResearchSynthesis,
  hasSufficientSanctionedResearchContent,
  rawSynthesisProposalSchema,
  type RawSynthesisProposal,
  type ResearchSynthesis,
  type ResearchSynthesisInput,
} from '@careeros/cie-research';
import { scoreResearchSynthesisCase } from './harness.js';
import type { RealCampaignResponse } from './real-campaign-runtime.js';
import type { ResearchSynthesisCase } from './types.js';

export const REAL_RESEARCH_RUNS_PER_CASE = 3;

export interface RealResearchCase extends ResearchSynthesisCase {
  thinNoSource?: boolean;
  unsupportedConclusionTrap?: boolean;
}

const DEFAULT_CAL = { weak: 0.5, medium: 0.75, strong: 1 };

/** Real-only coverage; the frozen `eval:ci` research goldens remain untouched. */
export const REAL_ONLY_RESEARCH_CASES: RealResearchCase[] = [
  {
    id: 'rs-r1-thin-no-source',
    description:
      'THIN/NO SOURCE: user context exists but no sanctioned finding is supplied. The honest production behavior is an explicit insufficient_data refusal with no model-derived fields.',
    thinNoSource: true,
    input: {
      findings: [],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['Python'], confidence: 0.7, evidenceRefs: ['f1'] },
      ],
      goals: [{ id: 'g1', statement: 'Evaluate data engineering opportunities', timeframe: '12 months' }],
      gaps: [],
      activePlanActions: [],
      allowedSources: [],
    },
    expected: {
      mustSurfaceFindingIds: [],
      mustNotSurfaceFindingIds: [],
      mustLinkGapIds: [],
      mustLinkGoalIds: [],
      mustLinkPlanActionIds: [],
      maxConfidenceBySupportingStrength: DEFAULT_CAL,
    },
  },
  {
    id: 'rs-r2-adv-correlation-temptation',
    description:
      'ADVERSARIAL SOURCE: a weak sanctioned survey reports association only and explicitly says salary/causation were not measured. It tempts an unsupported guaranteed-raise conclusion, which must not survive.',
    adversarial: true,
    unsupportedConclusionTrap: true,
    trap: 'Turn correlation into a causal salary guarantee.',
    input: {
      findings: [
        {
          id: 'rf-cert-association',
          domain: 'certs',
          claim:
            'A small licensed survey (n=120) found an association between certification completion and interview invitations; it did not measure salary outcomes and does not establish causation.',
          sourceId: 'licensed-cert-outcomes-2026',
          strength: 'weak',
        },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['AWS'], confidence: 0.8, evidenceRefs: ['f-aws'] },
      ],
      goals: [{ id: 'g-cert', statement: 'Evaluate whether an AWS certification supports interview readiness' }],
      gaps: [
        { id: 'gap-cert', skill: 'AWS certification', nodeId: 'n-aws-cert', description: 'Certification not yet completed.' },
      ],
      activePlanActions: [
        { id: '90d-cert', title: 'Compare AWS certification study options', goalId: 'g-cert' },
      ],
      allowedSources: ['licensed-cert-outcomes-2026'],
    },
    expected: {
      mustSurfaceFindingIds: ['rf-cert-association'],
      mustNotSurfaceFindingIds: [],
      mustLinkGapIds: ['gap-cert'],
      mustLinkGoalIds: ['g-cert'],
      mustLinkPlanActionIds: ['90d-cert'],
      maxConfidenceBySupportingStrength: DEFAULT_CAL,
    },
    forbidden: [
      'certification guarantees a $30k raise',
      'certification causes higher salaries',
      'guaranteed salary increase',
    ],
  },
];

const EMPTY_PROPOSAL: RawSynthesisProposal = { insights: [], recommendations: [], citations: {} };
const norm = (value: string): string => value.trim().toLowerCase();

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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parseRaw(text: string): { proposal: RawSynthesisProposal | null; object: Record<string, unknown> | null } {
  const value = parseJson(text);
  const parsed = rawSynthesisProposalSchema.safeParse(value);
  const object = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  return { proposal: parsed.success ? parsed.data : null, object };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sameStrings(a: string[], b: string[]): boolean {
  return JSON.stringify(unique(a).sort()) === JSON.stringify(unique(b).sort());
}

function urlsIn(text: string): string[] {
  return unique(text.match(/https?:\/\/[^\s"'<>]+/gi) ?? []);
}

function outputSignature(synthesis: ResearchSynthesis): string {
  return JSON.stringify(synthesis);
}

function expectedSourcesForInsight(
  findingIds: string[],
  input: ResearchSynthesisInput,
): string[] {
  const findingById = new Map(input.findings.map((finding) => [finding.id, finding]));
  return unique(
    findingIds
      .map((id) => findingById.get(id)?.sourceId)
      .filter((source): source is string => source !== undefined),
  );
}

function confidenceCapForFindingIds(findingIds: string[], input: ResearchSynthesisInput): number | null {
  const cap = input.maxConfidenceBySupportingStrength ?? DEFAULT_CONFIDENCE_CAP;
  const rank = { weak: 0, medium: 1, strong: 2 } as const;
  const support = input.findings
    .filter((finding) => findingIds.includes(finding.id))
    .sort((a, b) => rank[b.strength] - rank[a.strength])[0];
  return support ? cap[support.strength] : null;
}

export interface RealResearchSample {
  run: number;
  insightCount: number;
  groundingTraceCorrect: number;
  attributionCorrect: number;
  sanctionedIntegrityCorrect: number;
  confidenceCapCorrect: number;
  relevanceOk: boolean;
  thinNoSourceCase: boolean;
  thinHonestEmpty: boolean;
  insufficientDataStatusAvailable: true;
  insufficientDataStatusEmitted: boolean;
  parseValid: boolean;
  rawInsufficientDataDeclared: boolean;
  rawUngroundedFindingRefs: number;
  rawUnresolvedCitations: number;
  rawAttributionMismatches: number;
  rawUnsanctionedCitations: number;
  rawOverclaimedConfidence: number;
  rawGenericInsights: number;
  rawUngroundedRecommendations: number;
  rawForbiddenConclusions: number;
  rawInventedUrls: number;
  guardrailCaught: number;
  fabricationLeaks: string[];
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  outputSignature: string;
  rawOutputSignature: string;
}

export function scoreRealResearchSample(input: {
  c: RealResearchCase;
  run: number;
  rawText: string;
  produced: ResearchSynthesis;
  response: RealCampaignResponse;
  latencyMs: number;
}): RealResearchSample {
  const { c, produced, rawText } = input;
  const productionInput = c.input as ResearchSynthesisInput;
  const findingById = new Map(productionInput.findings.map((finding) => [finding.id, finding]));
  const realFindingIds = new Set(findingById.keys());
  const allowedSources = new Set(productionInput.allowedSources);
  const providedSources = new Set(productionInput.findings.map((finding) => finding.sourceId));
  const goalIds = new Set(productionInput.goals.map((goal) => goal.id));
  const gapIds = new Set(productionInput.gaps.map((gap) => gap.id));
  const actionIds = new Set(productionInput.activePlanActions.map((action) => action.id));
  const forbidden = c.forbidden ?? [];
  const leaks = new Set<string>();
  const output = produced.status === 'ok' ? produced : undefined;

  let groundingTraceCorrect = 0;
  let attributionCorrect = 0;
  let sanctionedIntegrityCorrect = 0;
  let confidenceCapCorrect = 0;
  const producedInsightIds = new Set(output?.insights.map((insight) => insight.id) ?? []);

  for (const insight of output?.insights ?? []) {
    const refsResolve = insight.findingIds.length > 0 && insight.findingIds.every((id) => realFindingIds.has(id));
    const claimsTrace = refsResolve && insight.findingIds.every((id) => {
      const finding = findingById.get(id);
      return finding !== undefined && insight.summary.includes(finding.claim) && insight.summary.includes(finding.sourceId);
    });
    if (claimsTrace) groundingTraceCorrect += 1;
    else leaks.add(`ungrounded-finding:${insight.id}`);

    const expectedSources = expectedSourcesForInsight(insight.findingIds, productionInput);
    const actualSources = output?.citations[insight.id] ?? [];
    const attributionOk = expectedSources.length > 0 && sameStrings(actualSources, expectedSources);
    if (attributionOk) attributionCorrect += 1;
    else leaks.add(`attribution:${insight.id}`);

    const sanctionedOk = actualSources.length > 0 && actualSources.every(
      (source) => allowedSources.has(source) && providedSources.has(source),
    );
    if (sanctionedOk) sanctionedIntegrityCorrect += 1;
    else leaks.add(`unsanctioned-or-unresolved-citation:${insight.id}`);

    const confidenceCap = confidenceCapForFindingIds(insight.findingIds, productionInput);
    if (confidenceCap !== null && insight.confidence <= confidenceCap) confidenceCapCorrect += 1;
    else leaks.add(`confidence-overclaim:${insight.id}`);
  }

  for (const citationInsightId of Object.keys(output?.citations ?? {})) {
    if (!producedInsightIds.has(citationInsightId)) leaks.add(`orphan-citation:${citationInsightId}`);
  }
  for (const url of urlsIn(outputSignature(produced))) leaks.add(`invented-url:${url}`);
  const finalText = norm(outputSignature(produced));
  for (const phrase of forbidden) {
    if (finalText.includes(norm(phrase))) leaks.add(`unsupported-conclusion:${phrase}`);
  }
  const expected = hasSufficientSanctionedResearchContent(productionInput)
    ? { status: 'ok' as const, ...groundResearchSynthesis(EMPTY_PROPOSAL, productionInput) }
    : { status: 'insufficient_data' as const, reason: RESEARCH_INSUFFICIENT_DATA_REASON };
  if (outputSignature(produced) !== outputSignature(expected)) leaks.add('guardrail-recompute-mismatch');

  const scored = scoreResearchSynthesisCase(c, produced);
  for (const item of scored.ungroundedInsights) leaks.add(`golden-ungrounded:${item}`);
  for (const item of scored.unsanctionedCitations) leaks.add(`golden-unsanctioned:${item}`);
  for (const item of scored.fabrications) leaks.add(`golden-forbidden:${item}`);

  const raw = parseRaw(rawText);
  const proposal = raw.proposal;
  let rawUngroundedFindingRefs = 0;
  let rawUnresolvedCitations = 0;
  let rawAttributionMismatches = 0;
  let rawUnsanctionedCitations = 0;
  let rawOverclaimedConfidence = 0;
  let rawGenericInsights = 0;
  let rawUngroundedRecommendations = 0;
  let rawForbiddenConclusions = 0;
  const rawInventedUrls = urlsIn(rawText).length;

  if (proposal === null) {
    // A malformed proposal fails closed in production and counts as one catch.
    rawUngroundedFindingRefs = 1;
  } else {
    const rawInsightIds = new Set(proposal.insights.map((insight) => insight.id));
    for (const insight of proposal.insights) {
      rawUngroundedFindingRefs += insight.findingIds.filter((id) => !realFindingIds.has(id)).length;
      if (insight.findingIds.length === 0) rawUngroundedFindingRefs += 1;
      const citations = proposal.citations[insight.id] ?? [];
      const expectedSources = expectedSourcesForInsight(insight.findingIds, productionInput);
      if (citations.length === 0) rawUnresolvedCitations += 1;
      rawUnresolvedCitations += citations.filter((source) => !providedSources.has(source)).length;
      rawUnsanctionedCitations += citations.filter((source) => !allowedSources.has(source)).length;
      if (!sameStrings(citations, expectedSources)) rawAttributionMismatches += 1;
      const confidenceCap = confidenceCapForFindingIds(insight.findingIds, productionInput);
      if (confidenceCap === null ? insight.confidence > 0 : insight.confidence > confidenceCap) {
        rawOverclaimedConfidence += 1;
      }
      const personalized =
        insight.goalRefs.some((id) => goalIds.has(id)) ||
        insight.gapRefs.some((id) => gapIds.has(id)) ||
        insight.planActionRefs.some((id) => actionIds.has(id));
      if (!personalized) rawGenericInsights += 1;
    }
    for (const [insightId, citations] of Object.entries(proposal.citations)) {
      if (!rawInsightIds.has(insightId)) rawUnresolvedCitations += Math.max(1, citations.length);
    }
    for (const recommendation of proposal.recommendations) {
      const linked =
        (recommendation.gapId !== undefined && gapIds.has(recommendation.gapId)) ||
        (recommendation.goalId !== undefined && goalIds.has(recommendation.goalId)) ||
        (recommendation.planActionId !== undefined && actionIds.has(recommendation.planActionId));
      if (!rawInsightIds.has(recommendation.insightId) || !linked) rawUngroundedRecommendations += 1;
    }
    const rawTextNormalized = norm(rawText);
    rawForbiddenConclusions = forbidden.filter((phrase) => rawTextNormalized.includes(norm(phrase))).length;
  }

  const guardrailCaught =
    rawUngroundedFindingRefs + rawUnresolvedCitations + rawAttributionMismatches +
    rawUnsanctionedCitations + rawOverclaimedConfidence + rawGenericInsights +
    rawUngroundedRecommendations + rawForbiddenConclusions + rawInventedUrls;
  const thinHonestEmpty = !c.thinNoSource || (
    produced.status === 'insufficient_data' &&
    produced.reason.trim().length > 0 &&
    leaks.size === 0
  );

  return {
    run: input.run,
    insightCount: output?.insights.length ?? 0,
    groundingTraceCorrect,
    attributionCorrect,
    sanctionedIntegrityCorrect,
    confidenceCapCorrect,
    relevanceOk: scored.passed && leaks.size === 0,
    thinNoSourceCase: c.thinNoSource ?? false,
    thinHonestEmpty,
    insufficientDataStatusAvailable: true,
    insufficientDataStatusEmitted: produced.status === 'insufficient_data',
    parseValid: proposal !== null,
    rawInsufficientDataDeclared: raw.object?.status === 'insufficient_data',
    rawUngroundedFindingRefs,
    rawUnresolvedCitations,
    rawAttributionMismatches,
    rawUnsanctionedCitations,
    rawOverclaimedConfidence,
    rawGenericInsights,
    rawUngroundedRecommendations,
    rawForbiddenConclusions,
    rawInventedUrls,
    guardrailCaught,
    fabricationLeaks: [...leaks],
    latencyMs: input.latencyMs,
    inputTokens: input.response.usage.inputTokens,
    outputTokens: input.response.usage.outputTokens,
    costUsd: input.response.costUsd,
    outputSignature: outputSignature(produced),
    rawOutputSignature: rawText,
  };
}

export interface RealResearchCaseResult {
  caseId: string;
  adversarial: boolean;
  thinNoSourceCase: boolean;
  samples: RealResearchSample[];
  insightCount: number;
  groundingTraceCorrect: number;
  attributionCorrect: number;
  sanctionedIntegrityCorrect: number;
  relevancePassedSamples: number;
  thinHonestEmptySamples: number;
  guardrailCaught: number;
  samplesWithGuardrailCaught: number;
  fabricationLeaks: number;
  meanLatencyMs: number;
  latencyStdDevMs: number;
  meanInputTokens: number;
  meanOutputTokens: number;
  totalCostUsd: number;
  distinctFinalOutputs: number;
  distinctRawOutputs: number;
}

export type RealResearchVerdict = 'GREEN' | 'YELLOW' | 'RED';

export interface RealResearchCampaignResult {
  model: string;
  caseCount: number;
  runsPerCase: number;
  sampleCount: number;
  cases: RealResearchCaseResult[];
  contractType: 'grounded-findings-and-citations-with-evidence-strength-cap';
  confidenceSemantics: 'evidence-strength-cap-not-probability';
  ece: null;
  groundingFidelity: number;
  groundingTraceCorrect: number;
  finalInsightCount: number;
  attributionCorrectness: number;
  attributionCorrect: number;
  sanctionedSourceIntegrity: number;
  sanctionedIntegrityCorrect: number;
  relevanceRate: number;
  confidenceCapFidelity: number;
  confidenceCapCorrect: number;
  thinNoSourceSampleCount: number;
  thinHonestEmptySamples: number;
  insufficientDataStatusSamples: number;
  statusContractAvailable: true;
  fabricationLeaks: number;
  parseValidSamples: number;
  rawInsufficientDataDeclaredSamples: number;
  guardrailCaught: number;
  samplesWithGuardrailCaught: number;
  rawUngroundedFindingRefs: number;
  rawUnresolvedCitations: number;
  rawAttributionMismatches: number;
  rawUnsanctionedCitations: number;
  rawOverclaimedConfidence: number;
  rawGenericInsights: number;
  rawUngroundedRecommendations: number;
  rawForbiddenConclusions: number;
  rawInventedUrls: number;
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
  verdict: RealResearchVerdict;
  verdictReasons: string[];
}

export function aggregateRealResearchCampaign(
  model: string,
  byCase: Array<{ c: RealResearchCase; samples: RealResearchSample[] }>,
): RealResearchCampaignResult {
  const samples = byCase.flatMap((entry) => entry.samples);
  const cases: RealResearchCaseResult[] = byCase.map(({ c, samples: caseSamples }) => ({
    caseId: c.id,
    adversarial: c.adversarial ?? false,
    thinNoSourceCase: c.thinNoSource ?? false,
    samples: caseSamples,
    insightCount: caseSamples.reduce((sum, sample) => sum + sample.insightCount, 0),
    groundingTraceCorrect: caseSamples.reduce((sum, sample) => sum + sample.groundingTraceCorrect, 0),
    attributionCorrect: caseSamples.reduce((sum, sample) => sum + sample.attributionCorrect, 0),
    sanctionedIntegrityCorrect: caseSamples.reduce((sum, sample) => sum + sample.sanctionedIntegrityCorrect, 0),
    relevancePassedSamples: caseSamples.filter((sample) => sample.relevanceOk).length,
    thinHonestEmptySamples: caseSamples.filter((sample) => sample.thinNoSourceCase && sample.thinHonestEmpty).length,
    guardrailCaught: caseSamples.reduce((sum, sample) => sum + sample.guardrailCaught, 0),
    samplesWithGuardrailCaught: caseSamples.filter((sample) => sample.guardrailCaught > 0).length,
    fabricationLeaks: caseSamples.reduce((sum, sample) => sum + sample.fabricationLeaks.length, 0),
    meanLatencyMs: mean(caseSamples.map((sample) => sample.latencyMs)),
    latencyStdDevMs: standardDeviation(caseSamples.map((sample) => sample.latencyMs)),
    meanInputTokens: mean(caseSamples.map((sample) => sample.inputTokens)),
    meanOutputTokens: mean(caseSamples.map((sample) => sample.outputTokens)),
    totalCostUsd: caseSamples.reduce((sum, sample) => sum + sample.costUsd, 0),
    distinctFinalOutputs: new Set(caseSamples.map((sample) => sample.outputSignature)).size,
    distinctRawOutputs: new Set(caseSamples.map((sample) => sample.rawOutputSignature)).size,
  }));
  const finalInsightCount = samples.reduce((sum, sample) => sum + sample.insightCount, 0);
  const groundingTraceCorrect = samples.reduce((sum, sample) => sum + sample.groundingTraceCorrect, 0);
  const attributionCorrect = samples.reduce((sum, sample) => sum + sample.attributionCorrect, 0);
  const sanctionedIntegrityCorrect = samples.reduce((sum, sample) => sum + sample.sanctionedIntegrityCorrect, 0);
  const confidenceCapCorrect = samples.reduce((sum, sample) => sum + sample.confidenceCapCorrect, 0);
  const thinSamples = samples.filter((sample) => sample.thinNoSourceCase);
  const fabricationLeaks = samples.reduce((sum, sample) => sum + sample.fabricationLeaks.length, 0);
  const guardrailCaught = samples.reduce((sum, sample) => sum + sample.guardrailCaught, 0);
  const samplesWithGuardrailCaught = samples.filter((sample) => sample.guardrailCaught > 0).length;
  const latencies = samples.map((sample) => sample.latencyMs);
  const costs = samples.map((sample) => sample.costUsd);
  const verdictReasons: string[] = [];
  let verdict: RealResearchVerdict = 'GREEN';
  if (fabricationLeaks > 0) {
    verdict = 'RED';
    verdictReasons.push('one or more final fabricated findings or unresolved/invented citations leaked');
  } else {
    if (finalInsightCount === 0 || groundingTraceCorrect !== finalInsightCount) {
      verdictReasons.push('final grounding fidelity was below 100%');
    }
    if (attributionCorrect !== finalInsightCount) verdictReasons.push('final citation attribution was below 100%');
    if (sanctionedIntegrityCorrect !== finalInsightCount) verdictReasons.push('sanctioned-source integrity was below 100%');
    if (samples.some((sample) => !sample.relevanceOk)) verdictReasons.push('one or more final samples missed the relevance/property gate');
    if (thinSamples.some((sample) => !sample.thinHonestEmpty)) verdictReasons.push('thin/no-source output was not fail-closed empty');
    if (samples.length > 0 && samplesWithGuardrailCaught / samples.length > 0.25) {
      verdictReasons.push('guardrail frequently masked actionable raw-model defects (>25% of samples)');
    }
    if (verdictReasons.length > 0) verdict = 'YELLOW';
  }

  return {
    model,
    caseCount: byCase.length,
    runsPerCase: REAL_RESEARCH_RUNS_PER_CASE,
    sampleCount: samples.length,
    cases,
    contractType: 'grounded-findings-and-citations-with-evidence-strength-cap',
    confidenceSemantics: 'evidence-strength-cap-not-probability',
    ece: null,
    groundingFidelity: finalInsightCount === 0 ? 1 : groundingTraceCorrect / finalInsightCount,
    groundingTraceCorrect,
    finalInsightCount,
    attributionCorrectness: finalInsightCount === 0 ? 1 : attributionCorrect / finalInsightCount,
    attributionCorrect,
    sanctionedSourceIntegrity: finalInsightCount === 0 ? 1 : sanctionedIntegrityCorrect / finalInsightCount,
    sanctionedIntegrityCorrect,
    relevanceRate: mean(samples.map((sample) => Number(sample.relevanceOk))),
    confidenceCapFidelity: finalInsightCount === 0 ? 1 : confidenceCapCorrect / finalInsightCount,
    confidenceCapCorrect,
    thinNoSourceSampleCount: thinSamples.length,
    thinHonestEmptySamples: thinSamples.filter((sample) => sample.thinHonestEmpty).length,
    insufficientDataStatusSamples: samples.filter((sample) => sample.insufficientDataStatusEmitted).length,
    statusContractAvailable: true,
    fabricationLeaks,
    parseValidSamples: samples.filter((sample) => sample.parseValid).length,
    rawInsufficientDataDeclaredSamples: samples.filter((sample) => sample.rawInsufficientDataDeclared).length,
    guardrailCaught,
    samplesWithGuardrailCaught,
    rawUngroundedFindingRefs: samples.reduce((sum, sample) => sum + sample.rawUngroundedFindingRefs, 0),
    rawUnresolvedCitations: samples.reduce((sum, sample) => sum + sample.rawUnresolvedCitations, 0),
    rawAttributionMismatches: samples.reduce((sum, sample) => sum + sample.rawAttributionMismatches, 0),
    rawUnsanctionedCitations: samples.reduce((sum, sample) => sum + sample.rawUnsanctionedCitations, 0),
    rawOverclaimedConfidence: samples.reduce((sum, sample) => sum + sample.rawOverclaimedConfidence, 0),
    rawGenericInsights: samples.reduce((sum, sample) => sum + sample.rawGenericInsights, 0),
    rawUngroundedRecommendations: samples.reduce((sum, sample) => sum + sample.rawUngroundedRecommendations, 0),
    rawForbiddenConclusions: samples.reduce((sum, sample) => sum + sample.rawForbiddenConclusions, 0),
    rawInventedUrls: samples.reduce((sum, sample) => sum + sample.rawInventedUrls, 0),
    meanLatencyMs: mean(latencies),
    latencyStdDevMs: standardDeviation(latencies),
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
    casesWithVariableFinalOutput: cases.filter((result) => result.distinctFinalOutputs > 1).length,
    casesWithVariableRawOutput: cases.filter((result) => result.distinctRawOutputs > 1).length,
    verdict,
    verdictReasons,
  };
}

export function formatRealResearchCampaign(result: RealResearchCampaignResult): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const rows = result.cases.map((c) => {
    const kind = c.thinNoSourceCase ? 'thin' : c.adversarial ? 'adv' : 'standard';
    return `| ${c.caseId} | ${kind} | ${c.relevancePassedSamples}/${c.samples.length} | ${c.groundingTraceCorrect}/${c.insightCount} | ${c.attributionCorrect}/${c.insightCount} | ${c.sanctionedIntegrityCorrect}/${c.insightCount} | ${c.fabricationLeaks} | ${c.guardrailCaught} (${c.samplesWithGuardrailCaught}/${c.samples.length}) | ${Math.round(c.meanLatencyMs)} ± ${Math.round(c.latencyStdDevMs)} | ${Math.round(c.meanInputTokens)} / ${Math.round(c.meanOutputTokens)} | $${c.totalCostUsd.toFixed(6)} | ${c.distinctRawOutputs}/${c.samples.length} |`;
  });
  return [
    `Model: ${result.model}`,
    `Samples: ${result.sampleCount} (${result.caseCount} cases × ${result.runsPerCase})`,
    `Contract type: GROUNDED findings + citations; confidence is an evidence-strength cap, not P(correct)`,
    `Verdict: ${result.verdict} — ${result.verdictReasons.join('; ') || 'all GREEN criteria met'}`,
    `Grounding fidelity: ${percent(result.groundingFidelity)} (${result.groundingTraceCorrect}/${result.finalInsightCount})`,
    `Attribution correctness: ${percent(result.attributionCorrectness)} (${result.attributionCorrect}/${result.finalInsightCount})`,
    `Sanctioned-source integrity: ${percent(result.sanctionedSourceIntegrity)} (${result.sanctionedIntegrityCorrect}/${result.finalInsightCount})`,
    `Relevance/property gate: ${percent(result.relevanceRate)}`,
    `Fabrication leaks: ${result.fabricationLeaks} ← MUST be 0`,
    `Thin/no-source: honest refusal ${result.thinHonestEmptySamples}/${result.thinNoSourceSampleCount}; insufficient_data status ${result.insufficientDataStatusSamples}/${result.thinNoSourceSampleCount}`,
    `Confidence/ECE: N/A (deterministic evidence-strength cap); cap fidelity ${percent(result.confidenceCapFidelity)}`,
    `Parse-valid raw proposals: ${result.parseValidSamples}/${result.sampleCount}`,
    `Guardrail caught: ${result.guardrailCaught} defects across ${result.samplesWithGuardrailCaught}/${result.sampleCount} samples`,
    `  by type — finding refs ${result.rawUngroundedFindingRefs}; unresolved citations ${result.rawUnresolvedCitations}; attribution ${result.rawAttributionMismatches}; unsanctioned citations ${result.rawUnsanctionedCitations}; confidence ${result.rawOverclaimedConfidence}; generic insights ${result.rawGenericInsights}; recommendations ${result.rawUngroundedRecommendations}; unsupported conclusions ${result.rawForbiddenConclusions}; invented URLs ${result.rawInventedUrls}`,
    `Latency: mean ${Math.round(result.meanLatencyMs)} ms; σ ${Math.round(result.latencyStdDevMs)} ms; p95 ${Math.round(result.p95LatencyMs)} ms`,
    `Tokens: ${result.totalInputTokens} input; ${result.totalOutputTokens} output`,
    `Cost: $${result.totalCostUsd.toFixed(6)} (mean $${result.meanCostUsd.toFixed(6)}/sample)`,
    `Final-output variance: ${result.casesWithVariableFinalOutput}/${result.caseCount} cases varied`,
    `Raw-output variance: ${result.casesWithVariableRawOutput}/${result.caseCount} cases varied`,
    '',
    '| Case | Kind | Final gate | Grounding | Attribution | Sanctioned | Leaks | Catches | Mean ± σ ms | Mean tokens in/out | Cost | Distinct raw |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}