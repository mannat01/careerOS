/**
 * Calibration integrity suite (M10 Step 1).
 *
 * These tests are the calibration guardrail's proof of honesty:
 *   1. an overconfident recommendation set yields a LOW score (miscalibration
 *      is not hidden);
 *   2. a well-calibrated set yields a HIGH score;
 *   3. the reasoner-facing feedback signal moves subsequent confidences in
 *      the CORRECT direction (overconfident domains get pulled DOWN);
 *   4. a "hide-the-miscalibration" fabricator is caught by the independent
 *      verifier.
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeCalibration,
  applyFeedback,
  extractFeedback,
  verifyCalibration,
} from '../src/analyzer.js';
import type {
  CalibrationReport,
  RealizedRecommendation,
} from '../src/model.js';

/** Build a domain-tagged batch with a stated confidence and a realized rate. */
function buildBatch(
  domain: string,
  confidence: number,
  realizedRate: number,
  count: number,
  idPrefix: string,
): RealizedRecommendation[] {
  const rows: RealizedRecommendation[] = [];
  const truthy = Math.round(realizedRate * count);
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `${idPrefix}-${i}`,
      domain,
      confidence,
      realized: i < truthy,
    });
  }
  return rows;
}

describe('confidence calibration — honest reporting', () => {
  it('an OVERCONFIDENT recommendation set yields a LOW calibration score', () => {
    // Every recommendation stamped 0.9 confidence, but only 30% panned out.
    const rows = buildBatch('apply', 0.9, 0.3, 100, 'overconf');

    const report = analyzeCalibration(rows);

    // The gap is |0.9 − 0.3| = 0.6 (all mass in one bucket), so
    // ECE = 0.6 and score = 1 − 0.6 = 0.4. LOW, not flattering.
    expect(report.ece).toBeCloseTo(0.6, 6);
    expect(report.calibrationScore).toBeCloseTo(0.4, 6);
    // Must be strictly below a "well-calibrated" threshold.
    expect(report.calibrationScore).toBeLessThan(0.5);

    // The independent verifier agrees — the report reflects reality.
    const verdict = verifyCalibration(rows, report);
    expect(verdict.ok).toBe(true);
  });

  it('a WELL-CALIBRATED recommendation set yields a HIGH calibration score', () => {
    // Multiple confidence tiers, each matching its realized rate:
    //   0.2 → 20% realized, 0.5 → 50%, 0.8 → 80%.
    const rows = [
      ...buildBatch('apply', 0.2, 0.2, 50, 'lo'),
      ...buildBatch('apply', 0.5, 0.5, 50, 'mid'),
      ...buildBatch('apply', 0.8, 0.8, 50, 'hi'),
    ];

    const report = analyzeCalibration(rows);

    // Each bucket's confidence matches its realized rate exactly ⇒ ECE ≈ 0.
    expect(report.ece).toBeCloseTo(0, 6);
    expect(report.calibrationScore).toBeCloseTo(1, 6);
    expect(report.calibrationScore).toBeGreaterThan(0.9);

    // And the well-calibrated set beats the overconfident set — the score
    // orders miscalibration correctly.
    const overconfReport = analyzeCalibration(buildBatch('apply', 0.9, 0.3, 100, 'overconf'));
    expect(report.calibrationScore).toBeGreaterThan(overconfReport.calibrationScore);
  });

  it('feedback signal moves the reasoner toward calibration (correct DIRECTION)', () => {
    // Two domains with opposite drift:
    //   'apply' overconfident (0.9 stated, 0.3 realized)
    //   'wait'  underconfident (0.2 stated, 0.7 realized)
    const rows = [
      ...buildBatch('apply', 0.9, 0.3, 100, 'over'),
      ...buildBatch('wait', 0.2, 0.7, 100, 'under'),
    ];
    const report = analyzeCalibration(rows);
    const feedback = extractFeedback(report);

    // Overconfident domain ⇒ NEGATIVE adjustment (pull confidence DOWN).
    expect(feedback.byDomain.apply).toBeLessThan(0);
    // Underconfident domain ⇒ POSITIVE adjustment (nudge confidence UP).
    expect(feedback.byDomain.wait).toBeGreaterThan(0);

    // Applying feedback to a raw confidence MOVES it toward the realized rate.
    // Overconfident domain: raw 0.9 → adjusted < 0.9 (closer to 0.3).
    const rawApply = 0.9;
    const adjApply = applyFeedback(rawApply, 'apply', feedback);
    expect(adjApply).toBeLessThan(rawApply);
    // The distance to the realized rate shrinks in the correct direction.
    expect(Math.abs(adjApply - 0.3)).toBeLessThan(Math.abs(rawApply - 0.3));

    // Underconfident domain: raw 0.2 → adjusted > 0.2 (closer to 0.7).
    const rawWait = 0.2;
    const adjWait = applyFeedback(rawWait, 'wait', feedback);
    expect(adjWait).toBeGreaterThan(rawWait);
    expect(Math.abs(adjWait - 0.7)).toBeLessThan(Math.abs(rawWait - 0.7));

    // A domain the reasoner has never observed falls back to the overall
    // signal (still finite, still in [-1, +1]).
    const adjUnknown = applyFeedback(0.5, 'unknown-domain', feedback);
    expect(Number.isFinite(adjUnknown)).toBe(true);
    expect(adjUnknown).toBeGreaterThanOrEqual(0);
    expect(adjUnknown).toBeLessThanOrEqual(1);
  });

  it("a 'hide-the-miscalibration' fabricator is caught by the verifier", () => {
    const rows = buildBatch('apply', 0.9, 0.3, 100, 'overconf');
    const honest = analyzeCalibration(rows);

    // Adversary #1: a fabricator that overstates the score to hide the gap.
    const flattered: CalibrationReport = {
      ...honest,
      // Real ECE=0.6, real score=0.4. Fabricator claims 0.95.
      ece: 0.05,
      calibrationScore: 0.95,
    };
    const flatteredVerdict = verifyCalibration(rows, flattered);
    expect(flatteredVerdict.ok).toBe(false);
    expect(flatteredVerdict.violations.some((v) => v.code === 'flattered_score')).toBe(true);

    // Adversary #2: a fabricator that flips the feedback sign — an
    // overconfident domain reported with a POSITIVE adjustment (which would
    // push subsequent confidences even HIGHER).
    const flippedSign: CalibrationReport = {
      ...honest,
      domains: honest.domains.map((d) =>
        d.domain === 'apply' ? { ...d, feedbackAdjustment: 0.5 } : d,
      ),
    };
    const flippedVerdict = verifyCalibration(rows, flippedSign);
    expect(flippedVerdict.ok).toBe(false);
    expect(
      flippedVerdict.violations.some((v) => v.code === 'wrong_feedback_direction'),
    ).toBe(true);

    // Adversary #3: sample-size mismatch (fabricator drops rows from the tally).
    const shrunk: CalibrationReport = { ...honest, sampleSize: 5 };
    const shrunkVerdict = verifyCalibration(rows, shrunk);
    expect(shrunkVerdict.ok).toBe(false);
    expect(shrunkVerdict.violations.some((v) => v.code === 'sample_size_mismatch')).toBe(true);
  });

  it('empty input yields sample_size=0 and does NOT fabricate a score', () => {
    const report = analyzeCalibration([]);
    expect(report.sampleSize).toBe(0);
    expect(report.domains).toEqual([]);
    // Score is 1 by convention (no evidence of miscalibration), NOT because
    // the model is claimed to be perfect. The report's sampleSize=0 tells the
    // caller they have no evidence, which the API layer surfaces honestly.
    expect(report.ece).toBe(0);
    expect(report.calibrationScore).toBe(1);
  });

  it('report is deterministic + evidence-carrying (shows its work)', () => {
    const rows = [
      ...buildBatch('apply', 0.9, 0.3, 100, 'over'),
      ...buildBatch('wait', 0.2, 0.7, 100, 'under'),
    ];
    const now = new Date('2026-01-01T00:00:00.000Z');
    const a = analyzeCalibration(rows, now);
    const b = analyzeCalibration(rows, now);
    expect(a).toEqual(b);

    // Per-domain slices are the evidence behind the overall score.
    expect(a.domains.length).toBe(2);
    for (const d of a.domains) {
      expect(d.count).toBe(100);
      expect(d.buckets.length).toBeGreaterThan(0);
      for (const bucket of d.buckets) {
        expect(bucket.count).toBeGreaterThan(0);
        expect(bucket.meanConfidence).toBeGreaterThanOrEqual(0);
        expect(bucket.meanConfidence).toBeLessThanOrEqual(1);
        expect(bucket.realizedRate).toBeGreaterThanOrEqual(0);
        expect(bucket.realizedRate).toBeLessThanOrEqual(1);
      }
    }
    expect(a.modelVersion).toBe('calibration@1.0.0');
  });
});