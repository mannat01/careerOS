import { describe, expect, it } from 'vitest';
import { groundMatchScore } from '@careeros/cie-resume';
import { loadScoringCases } from '../src/datasets.js';
import { aggregateRealScoringCampaign, scoreRealScoringSample } from '../src/real-scoring-harness.js';

const response = { usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.001 };

describe('real scoring measurement harness', () => {
  it('counts unsafe raw proposal violations while final grounded output has no leak', () => {
    const c = loadScoringCases().find((item) => item.id === 'sc-02-weak-match');
    expect(c).toBeDefined();
    if (!c) return;
    const produced = groundMatchScore(
      { overall: 95, subscores: [], explanation: '', evidenceRefs: [] },
      c.profile,
      c.job,
    );
    const sample = scoreRealScoringSample({
      c, run: 1, produced, response, latencyMs: 100,
      rawText: JSON.stringify({
        overall: 95,
        subscores: [{ key: 'skills_match', value: 95 }],
        explanation: 'The candidate has a strong Python background.',
        evidenceRefs: ['f-fabricated'],
      }),
    });
    expect(sample.rawScoreOutsideBand).toBe(true);
    expect(sample.rawUngroundedEvidenceRefs).toBe(1);
    expect(sample.rawForbiddenClaims).toBe(1);
    expect(sample.rawMissingSubscores).toBe(2);
    expect(sample.guardrailCaught).toBe(5);
    expect(sample.fabricationLeaks).toEqual([]);
  });

  it('reports a surviving ungrounded evidence ref as a fabrication leak', () => {
    const c = loadScoringCases()[0];
    expect(c).toBeDefined();
    if (!c) return;
    const honest = groundMatchScore(
      { overall: 0, subscores: [], explanation: '', evidenceRefs: [] },
      c.profile,
      c.job,
    );
    // cases[0] is a strong, assessable case → the `ok` arm.
    if (honest.status !== 'ok') throw new Error('expected an ok score');
    const produced = { ...honest, evidenceRefs: [...honest.evidenceRefs, 'f-fabricated'] };
    const sample = scoreRealScoringSample({
      c, run: 1, produced, response, latencyMs: 100,
      rawText: JSON.stringify({ overall: 90, subscores: [], explanation: '', evidenceRefs: [] }),
    });
    expect(sample.fabricationLeaks).toContain('ungrounded-evidence:f-fabricated');
  });

  it('reports unavailable confidence and deterministic score variance honestly', () => {
    const c = loadScoringCases()[0];
    expect(c).toBeDefined();
    if (!c) return;
    const base = {
      run: 1, overall: 90, rawOverall: 88, bandCorrect: true,
      expectedLabel: 'high' as const, predictedLabel: 'high' as const, labelCorrect: true,
      confidenceAvailable: false as const, confidence: null,
      rawScoreOutsideBand: false, rawScoreCorrected: true, rawUngroundedEvidenceRefs: 0,
      rawForbiddenClaims: 0, rawMissingSubscores: 0, guardrailCaught: 0, fabricationLeaks: [],
      thinEvidenceCase: false, thinFitHandled: true, thinUncertaintyHandled: false,
      latencyMs: 100, inputTokens: 10, outputTokens: 5, costUsd: 0.001,
      outputSignature: 'final', rawOutputSignature: 'raw-a', parseValid: true,
    };
    const result = aggregateRealScoringCampaign('model', [{ c, samples: [
      { ...base, run: 1 },
      { ...base, run: 2, rawOutputSignature: 'raw-b' },
      { ...base, run: 3, rawOutputSignature: 'raw-c' },
    ] }]);
    expect(result.bandAccuracy).toBe(1);
    expect(result.labelAccuracy).toBe(1);
    expect(result.confidenceAvailableSamples).toBe(0);
    expect(result.ece).toBeNull();
    expect(result.casesWithVariableOverall).toBe(0);
    expect(result.casesWithVariableRawOutput).toBe(1);
  });
});
