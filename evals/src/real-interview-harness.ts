/**
 * Track B Slice 7 — real-model interview-prep measurement harness.
 *
 * Interview prep is grounded generation, not probabilistic prediction:
 * questions trace to exact opportunity requirements and answer framing traces
 * to production-sanctioned profile facts. Graph nodes remain advisory context
 * but are not valid public answer evidence. There is no confidence field, so ECE is
 * intentionally N/A. The shipped output is independently compared with a
 * fresh `groundInterviewPrep` discard-and-recompute oracle, while raw proposal
 * defects are counted separately to reveal guardrail masking.
 */
import { createHash } from 'node:crypto';
import {
  groundInterviewPrep,
  rawInterviewProposalSchema,
  rawProposalToPrep,
  type InterviewPrep,
  type InterviewQuestionKind,
} from '@careeros/cie-interview';
import { scoreInterviewPrepCase } from './interview-harness.js';
import type { RealCampaignResponse } from './real-campaign-runtime.js';
import type { InterviewPrepCase } from './types.js';

export const REAL_INTERVIEW_RUNS_PER_CASE = 3;
export const REAL_INTERVIEW_THIN_CASE_ID = 'ip-r1-thin-no-profile';

export interface RealInterviewCase extends InterviewPrepCase {
  thinInsufficientData?: boolean;
}

/**
 * Mirror the production `ProfileInterviewEvidenceAdapter`: suggested framing
 * may cite caller-owned profile facts only, never derived graph-node IDs. The
 * graph remains available as advisory context, exactly as it is in production.
 */
export function toProductionInterviewCase(c: RealInterviewCase): RealInterviewCase {
  return {
    ...c,
    input: {
      ...c.input,
      allowedFactRefs: c.input.profile.map((fact) => fact.id),
    },
  };
}

/** Real-only refusal coverage. Frozen CI interview goldens remain untouched. */
export const REAL_ONLY_INTERVIEW_CASES: RealInterviewCase[] = ([
  {
    id: REAL_INTERVIEW_THIN_CASE_ID,
    description:
      'THIN: a real opportunity exists but the profile, state, graph, and sanctioned fact-ref set are empty. The production service must make no model call and the public path must return insufficient_data without questions or suggested answers.',
    thinInsufficientData: true,
    input: {
      profile: [],
      stateModel: [],
      graph: [],
      opportunity: {
        title: 'Backend Engineer',
        seniority: 'mid-level',
        requirements: ['production API ownership'],
        text: 'Own and operate production APIs with a cross-functional product team.',
      },
      allowedFactRefs: [],
    },
    expected: {
      mustCoverRequirements: [],
      mustGenerateQuestionKinds: [],
      answerGroundingFactIds: {},
      gapCompetencies: [],
      allowedGapStrategies: ['honest_bridge', 'address_gap'],
    },
  },
] satisfies RealInterviewCase[]).map(toProductionInterviewCase);

export interface InterviewReadyOutput {
  status: 'ready';
  opportunityId: string;
  modelVersion: string;
  questions: Array<{
    id: string;
    kind: InterviewQuestionKind;
    prompt: string;
    grounding: {
      opportunityId: string;
      requirements: string[];
      profileFactRefs: string[];
    };
    suggestedAnswer: {
      framing: string;
      evidence: Array<{ claim: string; factRef: string }>;
      honestGap?: {
        strategy: 'honest_bridge' | 'address_gap';
        competency: string;
        note: string;
      };
    };
  }>;
}

export interface InterviewInsufficientOutput {
  status: 'insufficient_data';
  opportunityId: string;
  reason: string;
  modelVersion: string;
}

export type InterviewProductionOutput = InterviewReadyOutput | InterviewInsufficientOutput;

const QUESTION_KINDS = new Set<InterviewQuestionKind>([
  'behavioral', 'technical', 'system_design', 'situational', 'values_fit',
]);

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function publicOutputToPrep(output: InterviewReadyOutput): InterviewPrep {
  return {
    modelVersion: output.modelVersion,
    questions: output.questions.map((question) => ({
      id: question.id,
      kind: question.kind,
      prompt: question.prompt,
      covers: question.grounding.requirements,
    })),
    answers: output.questions.map((question) => ({
      questionId: question.id,
      text: question.suggestedAnswer.framing,
      evidenceMap: question.suggestedAnswer.evidence,
      ...(question.suggestedAnswer.honestGap
        ? { honestGap: question.suggestedAnswer.honestGap }
        : {}),
    })),
  };
}

function prepSignature(prep: InterviewPrep): string {
  return JSON.stringify({
    questions: prep.questions.map((question) => ({
      id: question.id,
      kind: question.kind,
      prompt: question.prompt,
      covers: question.covers,
    })),
    answers: prep.answers.map((answer) => ({
      questionId: answer.questionId,
      text: answer.text,
      evidenceMap: answer.evidenceMap,
      honestGap: answer.honestGap ?? null,
    })),
    modelVersion: prep.modelVersion,
  });
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function outputSignature(output: InterviewProductionOutput): string {
  return digest(JSON.stringify(output));
}

interface RawDefects {
  parseValid: boolean;
  offOpportunityQuestions: number;
  unsupportedEvidenceRefs: number;
  unsupportedAnswerClaims: number;
  missingHonestGaps: number;
  malformedItems: number;
  rawRelevanceOk: boolean;
  signature: string;
}

function inspectRaw(c: RealInterviewCase, rawText: string): RawDefects {
  const value = parseJson(rawText);
  const parsed = rawInterviewProposalSchema.safeParse(value);
  const object = asRecord(value);
  const rawQuestions = Array.isArray(object?.questions) ? object.questions : [];
  const rawAnswers = Array.isArray(object?.answers) ? object.answers : [];
  const requirements = new Set(c.input.opportunity.requirements);
  const allowedRefs = new Set(c.input.allowedFactRefs);
  const gapRequirements = new Set(c.expected.gapCompetencies);
  const questionCovers = new Map<string, string[]>();
  let malformedItems = 0;
  let offOpportunityQuestions = 0;

  const sanitizedQuestions: InterviewPrep['questions'] = [];
  for (const [index, item] of rawQuestions.entries()) {
    const question = asRecord(item);
    const covers = strings(question?.covers);
    const id = typeof question?.id === 'string' ? question.id : `raw-q-${index}`;
    const prompt = typeof question?.prompt === 'string' ? question.prompt : '';
    const kind = typeof question?.kind === 'string' && QUESTION_KINDS.has(question.kind as InterviewQuestionKind)
      ? question.kind as InterviewQuestionKind
      : 'behavioral';
    const malformed = question === null || prompt.length === 0 || covers.length === 0;
    if (malformed) malformedItems += 1;
    const invalidCovers = covers.filter((cover) => !requirements.has(cover));
    offOpportunityQuestions += invalidCovers.length + Number(covers.length === 0);
    questionCovers.set(id, covers);
    sanitizedQuestions.push({ id, prompt, kind, covers });
  }

  let unsupportedEvidenceRefs = 0;
  let unsupportedAnswerClaims = 0;
  let missingHonestGaps = 0;
  const sanitizedAnswers: InterviewPrep['answers'] = [];
  const rawHaystackParts: string[] = [];
  for (const [index, item] of rawAnswers.entries()) {
    const answer = asRecord(item);
    const questionId = typeof answer?.questionId === 'string' ? answer.questionId : `raw-answer-${index}`;
    const text = typeof answer?.text === 'string' ? answer.text : '';
    const evidenceValues = Array.isArray(answer?.evidenceMap) ? answer.evidenceMap : [];
    const evidenceMap = evidenceValues.flatMap((entry) => {
      const evidence = asRecord(entry);
      if (typeof evidence?.claim !== 'string' || typeof evidence.factRef !== 'string') {
        malformedItems += 1;
        return [];
      }
      return [{ claim: evidence.claim, factRef: evidence.factRef }];
    });
    unsupportedEvidenceRefs += evidenceMap.filter((evidence) => !allowedRefs.has(evidence.factRef)).length;
    const covers = questionCovers.get(questionId) ?? [];
    const needsHonestGap = covers.some((cover) => gapRequirements.has(cover));
    const gap = asRecord(answer?.honestGap);
    const honestGap: InterviewPrep['answers'][number]['honestGap'] = gap &&
      (gap.strategy === 'honest_bridge' || gap.strategy === 'address_gap') &&
      typeof gap.competency === 'string' && typeof gap.note === 'string'
      ? { strategy: gap.strategy, competency: gap.competency, note: gap.note }
      : undefined;
    if (needsHonestGap && !honestGap) missingHonestGaps += 1;
    if (answer === null || text.length === 0 || !questionCovers.has(questionId)) malformedItems += 1;
    rawHaystackParts.push(text, ...evidenceMap.map((evidence) => evidence.claim), honestGap?.note ?? '');
    sanitizedAnswers.push({ questionId, text, evidenceMap, ...(honestGap ? { honestGap } : {}) });
  }

  const rawHaystack = norm(rawHaystackParts.join('\n'));
  unsupportedAnswerClaims = (c.forbidden ?? []).filter((claim) => rawHaystack.includes(norm(claim))).length;
  const rawPrep: InterviewPrep = {
    questions: sanitizedQuestions,
    answers: sanitizedAnswers,
    modelVersion: 'raw-proposal',
  };
  const rawRelevanceOk = !c.thinInsufficientData && scoreInterviewPrepCase(c, rawPrep).passed;
  return {
    parseValid: parsed.success,
    offOpportunityQuestions,
    unsupportedEvidenceRefs,
    unsupportedAnswerClaims,
    missingHonestGaps,
    malformedItems: malformedItems + Number(!parsed.success),
    rawRelevanceOk,
    signature: digest(rawText),
  };
}

export interface RealInterviewSample {
  run: number;
  status: InterviewProductionOutput['status'];
  questionCount: number;
  questionGroundingCorrect: number;
  framingGroundingCorrect: number;
  relevanceOk: boolean;
  fabricationLeaks: string[];
  thinCase: boolean;
  thinHonestRefusal: boolean;
  parseValid: boolean;
  rawOffOpportunityQuestions: number;
  rawUnsupportedEvidenceRefs: number;
  rawUnsupportedAnswerClaims: number;
  rawMissingHonestGaps: number;
  rawMalformedItems: number;
  rawRelevanceOk: boolean;
  guardrailCaught: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  outputSignature: string;
  rawOutputSignature: string;
}

export function scoreRealInterviewSample(input: {
  c: RealInterviewCase;
  run: number;
  rawText: string;
  output: InterviewProductionOutput;
  response: RealCampaignResponse;
  latencyMs: number;
}): RealInterviewSample {
  const { c, output } = input;
  const thinCase = c.thinInsufficientData === true;
  const raw = thinCase
    ? {
        parseValid: true,
        offOpportunityQuestions: 0,
        unsupportedEvidenceRefs: 0,
        unsupportedAnswerClaims: 0,
        missingHonestGaps: 0,
        malformedItems: 0,
        rawRelevanceOk: true,
        signature: digest(input.rawText),
      }
    : inspectRaw(c, input.rawText);
  const fabricationLeaks: string[] = [];
  let questionCount = 0;
  let questionGroundingCorrect = 0;
  let framingGroundingCorrect = 0;
  let relevanceOk = false;

  if (output.status === 'ready') {
    const prep = publicOutputToPrep(output);
    const allowedRefs = new Set(c.input.allowedFactRefs);
    const requirements = new Set(c.input.opportunity.requirements);
    questionCount = output.questions.length;
    for (const question of output.questions) {
      const questionGrounded =
        question.grounding.opportunityId === output.opportunityId &&
        question.grounding.requirements.length > 0 &&
        question.grounding.requirements.every((requirement) => requirements.has(requirement));
      if (questionGrounded) questionGroundingCorrect += 1;
      else fabricationLeaks.push(`ungrounded-question:${question.id}`);

      const evidenceRefs = question.suggestedAnswer.evidence.map((evidence) => evidence.factRef);
      const framingGrounded =
        evidenceRefs.every((ref) => allowedRefs.has(ref)) &&
        question.grounding.profileFactRefs.every((ref) => allowedRefs.has(ref)) &&
        JSON.stringify(evidenceRefs) === JSON.stringify(question.grounding.profileFactRefs) &&
        (evidenceRefs.length > 0 || question.suggestedAnswer.honestGap?.strategy === 'address_gap');
      if (framingGrounded) framingGroundingCorrect += 1;
      else fabricationLeaks.push(`unsupported-framing:${question.id}`);
    }

    const scored = scoreInterviewPrepCase(c, prep);
    fabricationLeaks.push(
      ...scored.questionIssues.map((issue) => `ungrounded-question:${issue.questionId}`),
      ...scored.answerIssues.flatMap((issue) =>
        issue.ungroundedFactRefs.map((ref) => `unsupported-answer-ref:${issue.questionId}:${ref}`)),
      ...scored.forbiddenLeaks.map((claim) => `unsupported-answer-claim:${claim}`),
    );
    const oracle = groundInterviewPrep({ questions: [], answers: [] }, c.input);
    if (prepSignature(prep) !== prepSignature(oracle)) {
      fabricationLeaks.push('guardrail-recompute-mismatch');
    }
    relevanceOk = scored.passed && fabricationLeaks.length === 0;
  } else if (!thinCase) {
    fabricationLeaks.push('unexpected-insufficient-data');
  }

  const uniqueLeaks = [...new Set(fabricationLeaks)];
  const thinHonestRefusal = thinCase && output.status === 'insufficient_data' && output.reason.trim().length > 0;
  const guardrailCaught =
    raw.offOpportunityQuestions + raw.unsupportedEvidenceRefs + raw.unsupportedAnswerClaims +
    raw.missingHonestGaps + raw.malformedItems;
  return {
    run: input.run,
    status: output.status,
    questionCount,
    questionGroundingCorrect,
    framingGroundingCorrect,
    relevanceOk: thinCase ? thinHonestRefusal : relevanceOk,
    fabricationLeaks: uniqueLeaks,
    thinCase,
    thinHonestRefusal,
    parseValid: raw.parseValid,
    rawOffOpportunityQuestions: raw.offOpportunityQuestions,
    rawUnsupportedEvidenceRefs: raw.unsupportedEvidenceRefs,
    rawUnsupportedAnswerClaims: raw.unsupportedAnswerClaims,
    rawMissingHonestGaps: raw.missingHonestGaps,
    rawMalformedItems: raw.malformedItems,
    rawRelevanceOk: raw.rawRelevanceOk,
    guardrailCaught,
    latencyMs: input.latencyMs,
    inputTokens: input.response.usage.inputTokens,
    outputTokens: input.response.usage.outputTokens,
    costUsd: input.response.costUsd,
    outputSignature: outputSignature(output),
    rawOutputSignature: raw.signature,
  };
}

export interface RealInterviewCaseResult {
  caseId: string;
  adversarial: boolean;
  thinCase: boolean;
  samples: RealInterviewSample[];
  relevanceRate: number;
  questionGroundingFidelity: number;
  framingGroundingFidelity: number;
  fabricationLeaks: number;
  thinHonestRefusals: number;
  guardrailCaught: number;
  samplesWithGuardrailCaught: number;
  rawRelevanceMisses: number;
  rawRelevanceOkSamples: number;
  meanLatencyMs: number;
  latencyStdDevMs: number;
  meanInputTokens: number;
  meanOutputTokens: number;
  totalCostUsd: number;
  distinctFinalOutputs: number;
  distinctRawOutputs: number;
}

export interface RealInterviewCampaignResult {
  model: string;
  runsPerCase: number;
  caseCount: number;
  sampleCount: number;
  paidCompletionCount: number;
  cases: RealInterviewCaseResult[];
  contractType: 'grounded-generation';
  confidence: 'not-present';
  ece: null;
  relevanceRate: number;
  questionGroundingFidelity: number;
  framingGroundingFidelity: number;
  fabricationLeaks: number;
  thinSampleCount: number;
  thinHonestRefusals: number;
  parseValidPaidSamples: number;
  guardrailCaught: number;
  samplesWithGuardrailCaught: number;
  rawOffOpportunityQuestions: number;
  rawUnsupportedEvidenceRefs: number;
  rawUnsupportedAnswerClaims: number;
  rawMissingHonestGaps: number;
  rawMalformedItems: number;
  rawRelevanceMisses: number;
  rawRelevanceOkSamples: number;
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

export function aggregateRealInterviewCampaign(
  model: string,
  byCase: Array<{ c: RealInterviewCase; samples: RealInterviewSample[] }>,
): RealInterviewCampaignResult {
  const allSamples = byCase.flatMap(({ samples }) => samples);
  const paidSamples = allSamples.filter((sample) => !sample.thinCase);
  const thinSamples = allSamples.filter((sample) => sample.thinCase);
  const totalQuestions = allSamples.reduce((sum, sample) => sum + sample.questionCount, 0);
  const cases = byCase.map(({ c, samples }): RealInterviewCaseResult => {
    const questionCount = samples.reduce((sum, sample) => sum + sample.questionCount, 0);
    const rawRelevanceMisses = samples.filter((sample) => !sample.thinCase && !sample.rawRelevanceOk).length;
    return {
      caseId: c.id,
      adversarial: c.adversarial === true,
      thinCase: c.thinInsufficientData === true,
      samples,
      relevanceRate: mean(samples.map((sample) => Number(sample.relevanceOk))),
      questionGroundingFidelity: questionCount === 0 ? 1 :
        samples.reduce((sum, sample) => sum + sample.questionGroundingCorrect, 0) / questionCount,
      framingGroundingFidelity: questionCount === 0 ? 1 :
        samples.reduce((sum, sample) => sum + sample.framingGroundingCorrect, 0) / questionCount,
      fabricationLeaks: samples.reduce((sum, sample) => sum + sample.fabricationLeaks.length, 0),
      thinHonestRefusals: samples.filter((sample) => sample.thinHonestRefusal).length,
      guardrailCaught: samples.reduce((sum, sample) => sum + sample.guardrailCaught, 0) + rawRelevanceMisses,
      samplesWithGuardrailCaught: samples.filter(
        (sample) => !sample.thinCase && (sample.guardrailCaught > 0 || !sample.rawRelevanceOk),
      ).length,
      rawRelevanceMisses,
      rawRelevanceOkSamples: samples.filter((sample) => sample.rawRelevanceOk).length,
      meanLatencyMs: mean(samples.map((sample) => sample.latencyMs)),
      latencyStdDevMs: standardDeviation(samples.map((sample) => sample.latencyMs)),
      meanInputTokens: mean(samples.map((sample) => sample.inputTokens)),
      meanOutputTokens: mean(samples.map((sample) => sample.outputTokens)),
      totalCostUsd: samples.reduce((sum, sample) => sum + sample.costUsd, 0),
      distinctFinalOutputs: new Set(samples.map((sample) => sample.outputSignature)).size,
      distinctRawOutputs: new Set(samples.map((sample) => sample.rawOutputSignature)).size,
    };
  });
  const fabricationLeaks = allSamples.reduce((sum, sample) => sum + sample.fabricationLeaks.length, 0);
  const relevanceRate = mean(allSamples.map((sample) => Number(sample.relevanceOk)));
  const thinHonestRefusals = thinSamples.filter((sample) => sample.thinHonestRefusal).length;
  const rawRelevanceMisses = paidSamples.filter((sample) => !sample.rawRelevanceOk).length;
  const samplesWithGuardrailCaught = paidSamples.filter(
    (sample) => sample.guardrailCaught > 0 || !sample.rawRelevanceOk,
  ).length;
  const verdictReasons: string[] = [];
  let verdict: RealInterviewCampaignResult['verdict'] = 'GREEN';
  if (fabricationLeaks > 0) {
    verdict = 'RED';
    verdictReasons.push('one or more final fabrication leaks (Sev-1)');
  } else {
    if (relevanceRate < 1) verdictReasons.push('one or more final outputs failed relevance/quality');
    if (thinHonestRefusals !== thinSamples.length) verdictReasons.push('thin case did not always return honest insufficient_data');
    if (paidSamples.length > 0 && samplesWithGuardrailCaught / paidSamples.length > 0.25) {
      verdictReasons.push('guardrail frequently masked raw-model defects (>25% of paid samples)');
    }
    if (verdictReasons.length > 0) verdict = 'YELLOW';
  }
  const latencies = allSamples.map((sample) => sample.latencyMs);
  const inputTokens = allSamples.map((sample) => sample.inputTokens);
  const outputTokens = allSamples.map((sample) => sample.outputTokens);
  const costs = allSamples.map((sample) => sample.costUsd);
  return {
    model,
    runsPerCase: REAL_INTERVIEW_RUNS_PER_CASE,
    caseCount: byCase.length,
    sampleCount: allSamples.length,
    paidCompletionCount: paidSamples.length,
    cases,
    contractType: 'grounded-generation',
    confidence: 'not-present',
    ece: null,
    relevanceRate,
    questionGroundingFidelity: totalQuestions === 0 ? 1 :
      allSamples.reduce((sum, sample) => sum + sample.questionGroundingCorrect, 0) / totalQuestions,
    framingGroundingFidelity: totalQuestions === 0 ? 1 :
      allSamples.reduce((sum, sample) => sum + sample.framingGroundingCorrect, 0) / totalQuestions,
    fabricationLeaks,
    thinSampleCount: thinSamples.length,
    thinHonestRefusals,
    parseValidPaidSamples: paidSamples.filter((sample) => sample.parseValid).length,
    guardrailCaught:
      paidSamples.reduce((sum, sample) => sum + sample.guardrailCaught, 0) + rawRelevanceMisses,
    samplesWithGuardrailCaught,
    rawOffOpportunityQuestions: paidSamples.reduce((sum, sample) => sum + sample.rawOffOpportunityQuestions, 0),
    rawUnsupportedEvidenceRefs: paidSamples.reduce((sum, sample) => sum + sample.rawUnsupportedEvidenceRefs, 0),
    rawUnsupportedAnswerClaims: paidSamples.reduce((sum, sample) => sum + sample.rawUnsupportedAnswerClaims, 0),
    rawMissingHonestGaps: paidSamples.reduce((sum, sample) => sum + sample.rawMissingHonestGaps, 0),
    rawMalformedItems: paidSamples.reduce((sum, sample) => sum + sample.rawMalformedItems, 0),
    rawRelevanceMisses,
    rawRelevanceOkSamples: paidSamples.filter((sample) => sample.rawRelevanceOk).length,
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

export function formatRealInterviewCampaign(result: RealInterviewCampaignResult): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const rows = result.cases.map((c) => {
    const kind = c.thinCase ? 'thin' : c.adversarial ? 'adv' : 'standard';
    const thin = c.thinCase ? `${c.thinHonestRefusals}/${c.samples.length}` : 'n/a';
    return `| ${c.caseId} | ${kind} | ${c.samples.filter((s) => s.relevanceOk).length}/${c.samples.length} | ${percent(c.questionGroundingFidelity)} | ${percent(c.framingGroundingFidelity)} | ${c.fabricationLeaks} | ${thin} | ${c.guardrailCaught} (${c.samplesWithGuardrailCaught}/${c.samples.length}) | ${Math.round(c.meanLatencyMs)} ± ${Math.round(c.latencyStdDevMs)} | ${Math.round(c.meanInputTokens)} / ${Math.round(c.meanOutputTokens)} | $${c.totalCostUsd.toFixed(6)} | ${c.distinctRawOutputs}/${c.samples.length} |`;
  });
  return [
    `Model: ${result.model}`,
    `Samples: ${result.sampleCount} (${result.caseCount} cases × ${result.runsPerCase}); paid completions ${result.paidCompletionCount}`,
    `Contract: grounded generation; confidence/ECE: N/A (no confidence field)`,
    `Verdict: ${result.verdict} — ${result.verdictReasons.join('; ') || 'all GREEN criteria met'}`,
    `Question grounding fidelity: ${percent(result.questionGroundingFidelity)}`,
    `Suggested-framing grounding fidelity: ${percent(result.framingGroundingFidelity)}`,
    `Relevance/quality: ${percent(result.relevanceRate)}`,
    `Fabrication leaks: ${result.fabricationLeaks} ← MUST be 0`,
    `Thin insufficient_data: ${result.thinHonestRefusals}/${result.thinSampleCount}`,
    `Parse-valid paid proposals: ${result.parseValidPaidSamples}/${result.paidCompletionCount}`,
    `Guardrail caught: ${result.guardrailCaught} defects across ${result.samplesWithGuardrailCaught}/${result.paidCompletionCount} paid samples`,
    `  by type — off-opportunity questions: ${result.rawOffOpportunityQuestions}; unsupported evidence refs: ${result.rawUnsupportedEvidenceRefs}; unsupported answer claims: ${result.rawUnsupportedAnswerClaims}; missing honest gaps: ${result.rawMissingHonestGaps}; malformed/fail-closed items: ${result.rawMalformedItems}; relevance/quality misses: ${result.rawRelevanceMisses}`,
    `Raw proposal passed the golden gate: ${result.rawRelevanceOkSamples}/${result.paidCompletionCount}`,
    `Latency: mean ${Math.round(result.meanLatencyMs)} ms; σ ${Math.round(result.latencyStdDevMs)} ms; p95 ${Math.round(result.p95LatencyMs)} ms`,
    `Tokens: ${result.totalInputTokens} input; ${result.totalOutputTokens} output`,
    `Cost: $${result.totalCostUsd.toFixed(6)} (mean $${result.meanCostUsd.toFixed(6)}/sample)`,
    `Final-output variance: ${result.casesWithVariableFinalOutput}/${result.caseCount} cases varied`,
    `Raw-output variance: ${result.casesWithVariableRawOutput}/${result.caseCount} cases varied`,
    '',
    '| Case | Kind | Relevance | Q grounding | Framing grounding | Leaks | Thin refusal | Catches | Mean ± σ ms | Mean tokens in/out | Cost | Distinct raw |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}

/** Test-only helper proving the raw bypass is classified as a final leak. */
export function rawInterviewOutputForTest(
  c: RealInterviewCase,
  rawText: string,
  opportunityId: string,
): InterviewReadyOutput {
  const parsed = rawInterviewProposalSchema.parse(parseJson(rawText));
  const prep = rawProposalToPrep(parsed, c.input);
  const answers = new Map(prep.answers.map((answer) => [answer.questionId, answer]));
  return {
    status: 'ready',
    opportunityId,
    modelVersion: prep.modelVersion,
    questions: prep.questions.flatMap((question) => {
      const answer = answers.get(question.id);
      if (!answer) return [];
      return [{
        id: question.id,
        kind: question.kind,
        prompt: question.prompt,
        grounding: {
          opportunityId,
          requirements: question.covers,
          profileFactRefs: answer.evidenceMap.map((evidence) => evidence.factRef),
        },
        suggestedAnswer: {
          framing: answer.text,
          evidence: answer.evidenceMap,
          ...(answer.honestGap ? { honestGap: answer.honestGap } : {}),
        },
      }];
    }),
  };
}