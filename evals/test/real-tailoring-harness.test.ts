import { describe, expect, it } from 'vitest';
import { atsCheck, renderVariant } from '@careeros/cie-resume';
import { loadTailoringCases } from '../src/datasets.js';
import { aggregateRealTailoringCampaign, scoreRealTailoringSample } from '../src/real-tailoring-harness.js';

const response = { usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.001 };

describe('real tailoring measurement harness', () => {
  it('counts structural and lexical raw embellishments as catches with no final leak', () => {
    const c = loadTailoringCases().find((item) => item.id === 'tl-11-adv-demands-kubernetes');
    expect(c).toBeDefined();
    if (!c) return;
    const bullet = { factId: 'f2', text: c.profile.find((fact) => fact.id === 'f2')!.summary };
    const rendered = renderVariant([bullet]);
    const sample = scoreRealTailoringSample({
      c, run: 1, response, latencyMs: 100,
      rawText: JSON.stringify({ bullets: [
        { factId: 'f-phantom', text: 'Managed production Kubernetes clusters' },
        { factId: 'f2', text: 'Managed production Kubernetes clusters' },
      ] }),
      produced: {
        bullets: [bullet], rendered, diff: { selected: ['f2'], dropped: [], rephrased: [] },
        rationale: 'grounded', atsCheck: atsCheck(rendered), modelVersion: 'test',
      },
    });
    expect(sample.structuralCatches).toBe(1);
    expect(sample.lexicalCatches).toBe(1);
    expect(sample.fabricationLeaks).toEqual([]);
  });

  it('reports an unfaithful surviving rephrasing as a fabrication leak', () => {
    const c = loadTailoringCases()[0];
    expect(c).toBeDefined();
    if (!c) return;
    const bullet = { factId: 'f1', text: 'Invented Kubernetes leadership' };
    const rendered = renderVariant([bullet]);
    const sample = scoreRealTailoringSample({
      c, run: 1, response, latencyMs: 100,
      rawText: JSON.stringify({ bullets: [bullet] }),
      produced: {
        bullets: [bullet], rendered, diff: { selected: ['f1'], dropped: [], rephrased: [] },
        rationale: 'bad', atsCheck: atsCheck(rendered), modelVersion: 'test',
      },
    });
    expect(sample.fabricationLeaks.some((leak) => leak.startsWith('unfaithful:'))).toBe(true);
  });

  it('micro-averages relevance and captures three-run variance', () => {
    const c = loadTailoringCases()[0];
    expect(c).toBeDefined();
    if (!c) return;
    const base = {
      run: 1, relevance: 1, matchedRelevantCount: 4, expectedRelevantCount: 4,
      producedCount: 4, rephrasedCount: 1, faithfulRephrasedCount: 1, rephrasingFaithfulness: 1,
      structuralCatches: 0, lexicalCatches: 0, guardrailCaught: 0, fabricationLeaks: [],
      atsPresent: true, atsValid: true, latencyMs: 100, inputTokens: 10, outputTokens: 5,
      costUsd: 0.001, outputSignature: 'a', parseValid: true,
    };
    const result = aggregateRealTailoringCampaign('model', [{ c, samples: [
      { ...base, run: 1 },
      { ...base, run: 2, relevance: 0.5, matchedRelevantCount: 2, outputSignature: 'b' },
      { ...base, run: 3 },
    ] }]);
    expect(result.overallRelevance).toBeCloseTo(10 / 12);
    expect(result.casesWithVariableRelevance).toBe(1);
    expect(result.casesWithVariableOutput).toBe(1);
  });
});