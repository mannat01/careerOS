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
    // sc-02 is a bad-but-ASSESSABLE fit → final `ok` arm, and the case expects ok.
    expect(sample.producedStatus).toBe('ok');
    expect(sample.expectedStatus).toBe('ok');
    expect(sample.statusCorrect).toBe(true);
  });

  it('scores insufficient_data correctness: a canonical raw refusal on a truly-thin case is NOT a structural defect', () => {
    const c = loadScoringCases().find((item) => item.id === 'sc-10-insufficient-data');
    expect(c).toBeDefined();
    if (!c) return;
    const produced = groundMatchScore(
      { overall: 0, subscores: [], explanation: '', evidenceRefs: [] },
      c.profile,
      c.job,
    );
    // The production guardrail refuses on this truly-thin profile.
    expect(produced.status).toBe('insufficient_data');
    const sample = scoreRealScoringSample({
      c, run: 1, produced, response, latencyMs: 100,
      // Raw model ALSO honestly refused (canonical shape) — no subscores by design.
      rawText: JSON.stringify({ status: 'insufficient_data', reason: 'no relevant evidence' }),
    });
    expect(sample.producedStatus).toBe('insufficient_data');
    expect(sample.expectedStatus).toBe('insufficient_data');
    expect(sample.statusCorrect).toBe(true);
    // A legitimate refusal carries no subscores — that must NOT be a "missing subscore".
    expect(sample.rawMissingSubscores).toBe(0);
    expect(sample.rawStatus).toBe('insufficient_data');
    expect(sample.guardrailCaught).toBe(0);
    expect(sample.fabricationLeaks).toEqual([]);
    // The final arm carries no numeric overall.
    expect(sample.overall).toBeNull();
  });

  it('counts noncanonical raw subscore keys as a shape defect (measurement only)', () => {
    const c = loadScoringCases().find((item) => item.id === 'sc-01-strong-match');
    expect(c).toBeDefined();
    if (!c) return;
    const produced = groundMatchScore(
      { overall: 0, subscores: [], explanation: '', evidenceRefs: [] },
      c.profile,
      c.job,
    );
    const sample = scoreRealScoringSample({
      c, run: 1, produced, response, latencyMs: 100,
      rawText: JSON.stringify({
        status: 'ok',
        overall: 90,
        subscores: [
          { key: 'skills_match', value: 90 },
          { key: 'culture_add', value: 80 }, // noncanonical
          { key: 'vibe', value: 70 },        // noncanonical
        ],
        explanation: 'x', evidenceRefs: [],
      }),
    });
    expect(sample.rawNoncanonicalSubscores).toBe(2);
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
      run: 1, overall: 90 as number | null, rawOverall: 88, bandCorrect: true,
      expectedLabel: 'high' as const, predictedLabel: 'high' as const, labelCorrect: true,
      producedStatus: 'ok' as const, expectedStatus: 'ok' as const, statusCorrect: true,
      rawStatus: 'ok' as const,
      confidenceAvailable: false as const, confidence: null,
      rawScoreOutsideBand: false, rawScoreCorrected: true, rawUngroundedEvidenceRefs: 0,
      rawForbiddenClaims: 0, rawMissingSubscores: 0, rawNoncanonicalSubscores: 0, guardrailCaught: 0, fabricationLeaks: [],
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
    expect(result.statusAccuracy).toBe(1);
    expect(result.confidenceAvailableSamples).toBe(0);
    expect(result.ece).toBeNull();
    expect(result.casesWithVariableOverall).toBe(0);
    expect(result.casesWithVariableRawOutput).toBe(1);
  });
});
