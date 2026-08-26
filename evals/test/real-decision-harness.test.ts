import { describe, expect, it } from 'vitest';
import { groundContract, type DecisionContract } from '@careeros/cie-reasoning';
import { loadDecisionCases } from '../src/datasets.js';
import {
  aggregateRealDecisionCampaign,
  reliabilityBinsAndEce,
  scoreRealDecisionSample,
  toApplyHold,
  type RealDecisionSample,
} from '../src/real-decision-harness.js';

const response = { usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.001 };
const EMPTY_PROPOSAL = {
  alternatives: [] as string[],
  evidenceRefs: [] as string[],
  reasoning: '',
  confidence: 0,
  assumptions: [] as string[],
  recommendation: '',
};

function realContract(id: string): { c: ReturnType<typeof loadDecisionCases>[number]; produced: DecisionContract } {
  const c = loadDecisionCases().find((item) => item.id === id);
  if (!c) throw new Error(`missing case ${id}`);
  // Drive the UNCHANGED production guardrail from the real inputs (proposal ignored).
  const produced = groundContract(EMPTY_PROPOSAL, c.profile, c.stateModel, c.opportunity, c.question);
  return { c, produced };
}

describe('real decision measurement harness', () => {
  it('maps recommendations to apply/hold operative outcomes', () => {
    expect(toApplyHold('apply')).toBe('apply');
    expect(toApplyHold('wait')).toBe('hold');
    expect(toApplyHold('negotiate')).toBe('hold');
  });

  it('grades a clear-apply case: correct label, confidence available + in-band, zero leaks', () => {
    const { c, produced } = realContract('ds-01-strong-match');
    const sample = scoreRealDecisionSample({
      c, run: 1, produced, response, latencyMs: 100,
      rawText: JSON.stringify({ ...EMPTY_PROPOSAL, recommendation: 'apply', confidence: 0.9 }),
    });
    expect(sample.expectedLabel).toBe('apply');
    expect(sample.predictedLabel).toBe('apply');
    expect(sample.labelCorrect).toBe(true);
    expect(sample.confidenceAvailable).toBe(true);
    expect(sample.confidenceInBand).toBe(true);
    expect(sample.fabricationLeaks).toEqual([]);
  });

  it('honestly handles an insufficient-fit case (barista vs backend): hold + near-zero confidence', () => {
    const { c, produced } = realContract('ds-03-thin-evidence');
    // The production guardrail refuses to invent readiness: hold at capped-low confidence.
    expect(toApplyHold(produced.recommendation)).toBe('hold');
    expect(produced.confidence).toBeLessThanOrEqual(0.2);
    const sample = scoreRealDecisionSample({
      c, run: 1, produced, response, latencyMs: 100,
      // The raw model pushed a confident "apply" with fabricated backend + phantom ref.
      rawText: JSON.stringify({
        ...EMPTY_PROPOSAL,
        recommendation: 'apply',
        confidence: 0.9,
        reasoning: 'Strong Python background and 5+ years of backend experience.',
        evidenceRefs: ['f1', 'f-fabricated-backend'],
      }),
    });
    expect(sample.insufficientFitCase).toBe(true);
    expect(sample.insufficientFitHandled).toBe(true);
    expect(sample.fabricationLeaks).toEqual([]);
    // The guardrail caught the raw over-reach: apply→wait, out-of-band conf, phantom ref, forbidden claim.
    expect(sample.rawRecommendationChanged).toBe(true);
    expect(sample.rawConfidenceOutsideBand).toBe(true);
    expect(sample.rawUngroundedEvidenceRefs).toBe(1);
    expect(sample.rawForbiddenClaims).toBeGreaterThan(0);
    expect(sample.guardrailCaught).toBeGreaterThanOrEqual(4);
  });

  it('flags a FINAL-output fabrication leak (Sev-1) if inflation survives grounding', () => {
    const { c, produced } = realContract('ds-03-thin-evidence');
    const leaky: DecisionContract = {
      ...produced,
      reasoning: `${produced.reasoning} strong Python background`, // a forbidden inflation string
      evidenceRefs: [...produced.evidenceRefs, 'f-fabricated'],
    };
    const sample = scoreRealDecisionSample({
      c, run: 1, produced: leaky, response, latencyMs: 100,
      rawText: JSON.stringify(EMPTY_PROPOSAL),
    });
    expect(sample.fabricationLeaks).toContain('ungrounded-evidence:f-fabricated');
    expect(sample.fabricationLeaks.some((l) => l.startsWith('forbidden:'))).toBe(true);
  });

  it('does not misclassify an honest future-role optionality note as current readiness', () => {
    const { c, produced } = realContract('ds-02-underqualified-staff');
    expect(produced.optionalityNote).toContain('Staff Software Engineer');
    const sample = scoreRealDecisionSample({
      c, run: 1, produced, response, latencyMs: 100,
      rawText: JSON.stringify(EMPTY_PROPOSAL),
    });
    expect(sample.fabricationLeaks).toEqual([]);
    expect(sample.thinHandled).toBe(true);
  });

  it('reliability bins + ECE are computed (confidence contract, not skipped)', () => {
    const base: RealDecisionSample = {
      run: 1, recommendation: 'apply', predictedLabel: 'apply', expectedLabel: 'apply', labelCorrect: true,
      confidenceAvailable: true, confidence: 0.9, confidenceInBand: true,
      insufficientFitCase: false, insufficientFitHandled: false, thinCase: false, thinHandled: true,
      rawRecommendation: 'apply', rawConfidence: 0.9, rawRecommendationChanged: false,
      rawConfidenceOutsideBand: false, rawUngroundedEvidenceRefs: 0, rawForbiddenClaims: 0, guardrailCaught: 0,
      fabricationLeaks: [], latencyMs: 100, inputTokens: 10, outputTokens: 5, costUsd: 0.001,
      outputSignature: 'a', rawOutputSignature: 'ra', parseValid: true,
    };
    const samples: RealDecisionSample[] = [
      base,
      { ...base, confidence: 0.85 },
      { ...base, confidence: 0.1, predictedLabel: 'hold', expectedLabel: 'hold', labelCorrect: true },
    ];
    const { bins, ece } = reliabilityBinsAndEce(samples);
    expect(ece).not.toBeNull();
    const high = bins.find((b) => b.label === '[0.8,1.0]');
    expect(high?.count).toBe(2);
    expect(high?.observedAccuracy).toBe(1);
  });

  it('aggregates apply/hold accuracy, insufficient-fit handling, and variance honestly', () => {
    const applyCase = realContract('ds-01-strong-match');
    const holdCase = realContract('ds-07-domain-mismatch'); // insufficient-fit + hold
    const applySample = scoreRealDecisionSample({
      c: applyCase.c, run: 1, produced: applyCase.produced, response, latencyMs: 100,
      rawText: JSON.stringify({ ...EMPTY_PROPOSAL, recommendation: 'apply', confidence: 0.9 }),
    });
    const holdSample = scoreRealDecisionSample({
      c: holdCase.c, run: 1, produced: holdCase.produced, response, latencyMs: 120,
      rawText: JSON.stringify({ ...EMPTY_PROPOSAL, recommendation: 'wait', confidence: 0.05 }),
    });
    const result = aggregateRealDecisionCampaign('model', [
      { c: applyCase.c, samples: [applySample, applySample, applySample] },
      { c: holdCase.c, samples: [holdSample, holdSample, holdSample] },
    ]);
    expect(result.sampleCount).toBe(6);
    expect(result.labelAccuracy).toBe(1);
    expect(result.applyCorrectSamples).toBe(3);
    expect(result.holdCorrectSamples).toBe(3);
    expect(result.confidenceAvailableSamples).toBe(6);
    expect(result.ece).not.toBeNull();
    expect(result.insufficientFitSampleCount).toBe(3);
    expect(result.insufficientFitHandledSamples).toBe(3);
    expect(result.fabricationLeaks).toBe(0);
    expect(result.casesWithVariableConfidence).toBe(0);
  });
});
