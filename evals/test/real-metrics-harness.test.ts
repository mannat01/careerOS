import { describe, expect, it } from 'vitest';
import {
  ALL_METRIC_KEYS,
  composeDashboardMetrics,
  rawProposalToMetrics,
  rawMetricExplanationsSchema,
} from '@careeros/cie-metrics';
import { loadDashboardMetricCases } from '../src/datasets.js';
import {
  REAL_ONLY_METRIC_CASES,
  aggregateRealMetricCampaign,
  scoreRealMetricSample,
  toRealMetricCase,
  type RealMetricCase,
} from '../src/real-metrics-harness.js';

const response = { usage: { inputTokens: 100, outputTokens: 50 }, costUsd: 0.002 };

function cases(): RealMetricCase[] {
  return [...loadDashboardMetricCases().map(toRealMetricCase), ...REAL_ONLY_METRIC_CASES];
}

function findCase(id: string): RealMetricCase {
  const c = cases().find((item) => item.id === id);
  if (!c) throw new Error(`Missing real metric case ${id}`);
  return c;
}

function safeRaw(c: RealMetricCase): string {
  const fallback = composeDashboardMetrics({ explanations: {} }, c.input);
  return JSON.stringify({
    explanations: Object.fromEntries(fallback.metrics.map((metric) => [metric.key, metric.explanation])),
  });
}

function safeSample(c: RealMetricCase, run: number) {
  const rawText = safeRaw(c);
  return scoreRealMetricSample({
    c,
    run,
    rawText,
    output: composeDashboardMetrics(rawMetricExplanationsSchema.parse(JSON.parse(rawText)), c.input),
    response,
    latencyMs: 100 + run,
  });
}

describe('real metrics measurement harness', () => {
  it('reuses 12 frozen goldens, covers all ten keys, and includes thin plus adversarial cases', () => {
    const all = cases();
    expect(all).toHaveLength(13);
    expect(new Set(all.map((c) => c.focusKey))).toEqual(new Set(ALL_METRIC_KEYS));
    expect(all.filter((c) => c.thinInsufficientData)).toHaveLength(2);
    expect(all.filter((c) => c.adversarial)).toHaveLength(4);
  });

  it('records strict insufficient_data handling with value absent and low confidence', () => {
    const c = findCase('dm-10-adv-fabricated-no-evidence');
    const sample = safeSample(c, 1);
    expect(sample.insufficientDataCorrect).toBe(true);
    expect(sample.confidenceHandlingCorrect).toBe(true);
    expect(sample.fabricationLeaks).toEqual([]);
  });

  it('counts fabricated raw numbers as catches while the production recompute stays leak-free', () => {
    const c = findCase('dm-09-adv-cheerleader-flat-trend');
    const rawText = JSON.stringify({
      explanations: Object.fromEntries(ALL_METRIC_KEYS.map((key) => [
        key,
        `${key} is surging to 99 because invented evidence matters. Improve it next step.`,
      ])),
    });
    const parsed = rawMetricExplanationsSchema.parse(JSON.parse(rawText));
    const sample = scoreRealMetricSample({
      c,
      run: 1,
      rawText,
      output: composeDashboardMetrics(parsed, c.input),
      response,
      latencyMs: 100,
    });
    expect(sample.rawUnsupportedNumbers).toBeGreaterThan(0);
    expect(sample.guardrailCaught).toBeGreaterThan(0);
    expect(sample.fabricationLeaks).toEqual([]);
  });

  it('classifies a neutered fabricated metric as a Sev-1 final leak', () => {
    const c = findCase('dm-11-adv-nonexistent-evidence-ref');
    const rawText = JSON.stringify({
      explanations: { career_momentum: 'Momentum is surging to 99 on invented evidence.' },
    });
    const raw = rawMetricExplanationsSchema.parse(JSON.parse(rawText));
    const output = rawProposalToMetrics(raw, c.input, {
      key: 'career_momentum',
      value: 99,
      evidenceRefs: ['ao-nonexistent'],
      linkedPlanActionId: '30d-fake-action',
    });
    const sample = scoreRealMetricSample({ c, run: 1, rawText, output, response, latencyMs: 100 });
    expect(sample.fabricationLeaks.length).toBeGreaterThan(0);
    expect(sample.fabricationLeaks).toContain('structural-recompute-mismatch:career_momentum');
    expect(aggregateRealMetricCampaign('model', [{ c, samples: [sample] }]).verdict).toBe('RED');
  });

  it('aggregates safe ×3 output with evidence-strength confidence and no ECE as GREEN', () => {
    const rich = findCase('dm-01-career-momentum-rising');
    const thin = findCase('dm-08-insufficient-data-networking');
    const result = aggregateRealMetricCampaign('model', [rich, thin].map((c) => ({
      c,
      samples: [1, 2, 3].map((run) => safeSample(c, run)),
    })));
    expect(result.fabricationLeaks).toBe(0);
    expect(result.groundingFidelity).toBe(1);
    expect(result.accuracyRate).toBe(1);
    expect(result.thinCorrect).toBe(3);
    expect(result.confidenceSemantics).toBe('evidence-strength');
    expect(result.ece).toBeNull();
    expect(result.verdict).toBe('GREEN');
  });

  it('yields YELLOW when the guard replaces explanations in more than 25% of samples', () => {
    const c = findCase('dm-01-career-momentum-rising');
    const samples = [1, 2, 3].map((run) => scoreRealMetricSample({
      c,
      run,
      rawText: JSON.stringify({ explanations: {} }),
      output: composeDashboardMetrics({ explanations: {} }, c.input),
      response,
      latencyMs: 100 + run,
    }));
    const result = aggregateRealMetricCampaign('model', [{ c, samples }]);
    expect(result.fabricationLeaks).toBe(0);
    expect(result.guardrailAffectedRate).toBe(1);
    expect(result.verdict).toBe('YELLOW');
  });
});