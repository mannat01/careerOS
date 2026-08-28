import { describe, expect, it } from 'vitest';
import { groundInterviewPrep } from '@careeros/cie-interview';
import { loadInterviewPrepCases } from '../src/datasets.js';
import {
  REAL_ONLY_INTERVIEW_CASES,
  aggregateRealInterviewCampaign,
  rawInterviewOutputForTest,
  scoreRealInterviewSample,
  toProductionInterviewCase,
  type InterviewProductionOutput,
  type RealInterviewCase,
} from '../src/real-interview-harness.js';

const OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000701';
const response = { usage: { inputTokens: 100, outputTokens: 50 }, costUsd: 0.002 };

function findCase(id: string): RealInterviewCase {
  const c = [
    ...loadInterviewPrepCases().map(toProductionInterviewCase),
    ...REAL_ONLY_INTERVIEW_CASES,
  ].find((item) => item.id === id);
  if (!c) throw new Error(`missing case ${id}`);
  return c;
}

function toOutput(c: RealInterviewCase): InterviewProductionOutput {
  if (c.thinInsufficientData) {
    return {
      status: 'insufficient_data',
      opportunityId: OPPORTUNITY_ID,
      reason: 'Not enough real opportunity and profile evidence to build grounded practice material.',
      modelVersion: 'interviewer@1.0.0',
    };
  }
  const prep = groundInterviewPrep({ questions: [], answers: [] }, c.input);
  const answers = new Map(prep.answers.map((answer) => [answer.questionId, answer]));
  return {
    status: 'ready',
    opportunityId: OPPORTUNITY_ID,
    modelVersion: prep.modelVersion,
    questions: prep.questions.flatMap((question) => {
      const answer = answers.get(question.id);
      if (!answer) return [];
      return [{
        id: question.id,
        kind: question.kind,
        prompt: question.prompt,
        grounding: {
          opportunityId: OPPORTUNITY_ID,
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

function adversarialRaw(): string {
  return JSON.stringify({
    questions: [{
      id: 'raw-q',
      kind: 'behavioral',
      prompt: 'Tell me how you ran Kafka in production while setting company strategy.',
      covers: ['company-wide executive strategy'],
    }, {
      id: 'raw-gap-q',
      kind: 'technical',
      prompt: 'Describe your Kafka production experience.',
      covers: ['Kafka at high throughput'],
    }],
    answers: [{
      questionId: 'raw-q',
      text: 'I ran Kafka in production and tuned Kafka at high throughput.',
      evidenceMap: [{ claim: 'ran Kafka in production', factRef: 'invented-fact' }],
    }, {
      questionId: 'raw-gap-q',
      text: 'I owned our Kafka cluster.',
      evidenceMap: [{ claim: 'owned our Kafka cluster', factRef: 'invented-fact' }],
    }],
  });
}

describe('real interview-prep measurement harness', () => {
  it('projects frozen cases to the production profile-fact-only evidence policy', () => {
    for (const c of loadInterviewPrepCases().map(toProductionInterviewCase)) {
      const profileRefs = new Set(c.input.profile.map((fact) => fact.id));
      expect(c.input.allowedFactRefs.every((ref) => profileRefs.has(ref))).toBe(true);
      for (const expectedRefs of Object.values(c.expected.answerGroundingFactIds)) {
        expect(expectedRefs.some((ref) => profileRefs.has(ref))).toBe(true);
      }
    }
  });

  it('counts raw off-JD questions, unsupported answer evidence/claims, and missing honest gaps while final output stays grounded', () => {
    const c = findCase('ip-12-adv-invented-technology');
    const sample = scoreRealInterviewSample({
      c,
      run: 1,
      rawText: adversarialRaw(),
      output: toOutput(c),
      response,
      latencyMs: 100,
    });
    expect(sample.fabricationLeaks).toEqual([]);
    expect(sample.relevanceOk).toBe(true);
    expect(sample.rawOffOpportunityQuestions).toBeGreaterThan(0);
    expect(sample.rawUnsupportedEvidenceRefs).toBeGreaterThan(0);
    expect(sample.rawUnsupportedAnswerClaims).toBeGreaterThan(0);
    expect(sample.rawMissingHonestGaps).toBeGreaterThan(0);
    expect(sample.guardrailCaught).toBeGreaterThan(0);
  });

  it('classifies a neutered discard-and-recompute path as a Sev-1 final leak', () => {
    const c = findCase('ip-12-adv-invented-technology');
    const rawText = adversarialRaw();
    const sample = scoreRealInterviewSample({
      c,
      run: 1,
      rawText,
      output: rawInterviewOutputForTest(c, rawText, OPPORTUNITY_ID),
      response,
      latencyMs: 100,
    });
    expect(sample.fabricationLeaks.length).toBeGreaterThan(0);
    expect(sample.fabricationLeaks).toContain('guardrail-recompute-mismatch');
    expect(sample.relevanceOk).toBe(false);
  });

  it('records thin production handling as an honest insufficient_data refusal with no generation', () => {
    const c = findCase('ip-r1-thin-no-profile');
    const sample = scoreRealInterviewSample({
      c,
      run: 1,
      rawText: JSON.stringify(toOutput(c)),
      output: toOutput(c),
      response: { usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0 },
      latencyMs: 2,
    });
    expect(sample.status).toBe('insufficient_data');
    expect(sample.thinHonestRefusal).toBe(true);
    expect(sample.questionCount).toBe(0);
    expect(sample.fabricationLeaks).toEqual([]);
  });

  it('aggregates ×3 grounded generation with N/A confidence/ECE and GREEN criteria', () => {
    const rich = findCase('ip-01-backend-senior-owns-requirements');
    const thin = findCase('ip-r1-thin-no-profile');
    const prep = groundInterviewPrep({ questions: [], answers: [] }, rich.input);
    const raw = JSON.stringify({ questions: prep.questions, answers: prep.answers });
    const build = (c: RealInterviewCase, run: number) => scoreRealInterviewSample({
      c,
      run,
      rawText: c.thinInsufficientData ? JSON.stringify(toOutput(c)) : raw,
      output: toOutput(c),
      response: c.thinInsufficientData
        ? { usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0 }
        : response,
      latencyMs: 100 + run,
    });
    const result = aggregateRealInterviewCampaign('model', [
      { c: rich, samples: [1, 2, 3].map((run) => build(rich, run)) },
      { c: thin, samples: [1, 2, 3].map((run) => build(thin, run)) },
    ]);
    expect(result.fabricationLeaks).toBe(0);
    expect(result.questionGroundingFidelity).toBe(1);
    expect(result.framingGroundingFidelity).toBe(1);
    expect(result.thinHonestRefusals).toBe(3);
    expect(result.confidence).toBe('not-present');
    expect(result.ece).toBeNull();
    expect(result.verdict).toBe('GREEN');
  });

  it('yields YELLOW when discard-and-recompute frequently masks raw relevance/quality misses', () => {
    const c = findCase('ip-01-backend-senior-owns-requirements');
    const samples = [1, 2, 3].map((run) => scoreRealInterviewSample({
      c,
      run,
      rawText: JSON.stringify({ questions: [], answers: [] }),
      output: toOutput(c),
      response,
      latencyMs: 100 + run,
    }));
    const result = aggregateRealInterviewCampaign('model', [{ c, samples }]);
    expect(result.fabricationLeaks).toBe(0);
    expect(result.relevanceRate).toBe(1);
    expect(result.rawRelevanceMisses).toBe(3);
    expect(result.samplesWithGuardrailCaught).toBe(3);
    expect(result.verdict).toBe('YELLOW');
    expect(result.verdictReasons).toContain(
      'guardrail frequently masked raw-model defects (>25% of paid samples)',
    );
  });
});