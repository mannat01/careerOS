import { describe, expect, it } from 'vitest';
import { loadExtractionCases } from '../src/datasets.js';
import { aggregateRealExtractionCampaign, scoreRealExtractionSample } from '../src/real-extraction-harness.js';

describe('real extraction measurement harness', () => {
  it('counts an ungrounded raw fabrication as caught and not leaked', () => {
    const c = loadExtractionCases().find((item) => item.id === 'ext-13-adv-aws-familiarity');
    expect(c).toBeDefined();
    if (!c) return;
    const rawText = JSON.stringify({ entities: [{
      kind: 'education', name: 'AWS Certified Solutions Architect', detail: 'AWS certification',
      quote: 'invented certification quote',
    }] });
    const sample = scoreRealExtractionSample({
      c, run: 1, rawText, produced: [], latencyMs: 100,
      response: { usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.000035 },
    });
    expect(sample.guardrailCaught).toBe(1);
    expect(sample.fabricationLeaks).toEqual([]);
    expect(sample.parseValid).toBe(true);
  });

  it('reports forbidden final output as a fabrication leak', () => {
    const c = loadExtractionCases().find((item) => item.id === 'ext-13-adv-aws-familiarity');
    expect(c).toBeDefined();
    if (!c) return;
    const quote = 'Familiar with AWS concepts and studying for the Solutions Architect certification.';
    const sample = scoreRealExtractionSample({
      c, run: 1, rawText: JSON.stringify({ entities: [] }),
      produced: [{ kind: 'education', name: 'AWS Certified Solutions Architect', provenance: { source: 'resume', quote } }],
      latencyMs: 100, response: { usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.000035 },
    });
    expect(sample.fabricationLeaks).toContain('forbidden:AWS Certified Solutions Architect');
  });

  it('micro-averages recall and captures three-run variance', () => {
    const c = loadExtractionCases()[0];
    expect(c).toBeDefined();
    if (!c) return;
    const base = {
      run: 1, matchedCount: c.expected.length, expectedCount: c.expected.length,
      provenanceCorrect: 1, producedCount: 1, provenanceCorrectness: 1,
      guardrailCaught: 0, fabricationLeaks: [], latencyMs: 100,
      inputTokens: 10, outputTokens: 5, costUsd: 0.000035, parseValid: true,
    };
    const result = aggregateRealExtractionCampaign('model', [{ c, samples: [
      { ...base, run: 1, recall: 1, outputSignature: 'a' },
      { ...base, run: 2, recall: 0.5, matchedCount: c.expected.length / 2, outputSignature: 'b' },
      { ...base, run: 3, recall: 1, outputSignature: 'a' },
    ] }]);
    expect(result.overallRecall).toBeCloseTo(5 / 6);
    expect(result.casesWithVariableRecall).toBe(1);
    expect(result.casesWithVariableOutput).toBe(1);
  });
});