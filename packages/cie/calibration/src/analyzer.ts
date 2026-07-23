/**
 * Deterministic calibration analyzer + independent verifier (M10 Step 1).
 *
 * HONEST-BY-CONSTRUCTION: the analyzer bins realized recommendations by
 * stated confidence, compares mean-confidence against realized-rate, and
 * computes the Expected Calibration Error (ECE). The reported score is
 * `1 − ECE` — an overconfident set (e.g. "90% sure" that panned out 30% of
 * the time) CANNOT flatter itself because the ECE gap is what enters the
 * score. The verifier re-checks this arithmetic against the raw inputs so a
 * "hide-the-miscalibration" fabricator is caught.
 */
import {
  CALIBRATION_MODEL_VERSION,
  type CalibrationBucket,
  type CalibrationFeedback,
  type CalibrationReport,
  type CalibrationVerification,
  type CalibrationViolation,
  type DomainCalibration,
  type RealizedRecommendation,
} from './model.js';

/** 10 equal-width buckets on [0,1]: [0,0.1), [0.1,0.2), …, [0.9,1.0]. */
const BUCKET_COUNT = 10;

// ---------- deterministic analysis ----------

/**
 * Compute the full calibration report from realized recommendations. The
 * computation is deterministic; identical inputs yield identical output.
 */
export function analyzeCalibration(
  input: RealizedRecommendation[],
  now: Date = new Date(0),
): CalibrationReport {
  // Filter to valid rows (defensive; caller ports enforce shape too).
  const rows = input.filter(
    (r) =>
      Number.isFinite(r.confidence) &&
      r.confidence >= 0 &&
      r.confidence <= 1 &&
      typeof r.domain === 'string' &&
      r.domain.length > 0,
  );

  const overallBuckets = buildBuckets(rows);
  const overallEce = computeEce(overallBuckets, rows.length);

  // Group by domain (stable, sorted) so output is deterministic.
  const byDomain = new Map<string, RealizedRecommendation[]>();
  for (const r of rows) {
    const list = byDomain.get(r.domain) ?? [];
    list.push(r);
    byDomain.set(r.domain, list);
  }
  const domains: DomainCalibration[] = [...byDomain.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((domain) => {
      const domainRows = byDomain.get(domain) ?? [];
      const buckets = buildBuckets(domainRows);
      const ece = computeEce(buckets, domainRows.length);
      return {
        domain,
        count: domainRows.length,
        buckets,
        ece,
        calibrationScore: 1 - ece,
        feedbackAdjustment: computeFeedbackAdjustment(domainRows),
      };
    });

  return {
    sampleSize: rows.length,
    buckets: overallBuckets,
    ece: overallEce,
    calibrationScore: 1 - overallEce,
    domains,
    modelVersion: CALIBRATION_MODEL_VERSION,
    computedAt: now.toISOString(),
  };
}

/**
 * Extract the reasoner-facing feedback signal from a report. The signal is
 * consumed by the reasoner as `confidence' = clamp01(confidence * (1 + adj))`
 * — so a NEGATIVE adjustment on an overconfident domain PULLS the next
 * confidence DOWN toward the realized rate (integrity suite proves it).
 */
export function extractFeedback(report: CalibrationReport): CalibrationFeedback {
  const byDomain: Record<string, number> = {};
  for (const d of report.domains) byDomain[d.domain] = d.feedbackAdjustment;
  const overall = computeOverallFeedback(report);
  return { byDomain, overall, modelVersion: report.modelVersion };
}

/**
 * Apply the feedback signal to a raw confidence for one domain. Multiplies
 * by (1 + adjustment) and clamps to [0,1]. This is the ONE transformation
 * the reasoner uses at inference time.
 */
export function applyFeedback(
  rawConfidence: number,
  domain: string,
  feedback: CalibrationFeedback,
): number {
  if (!Number.isFinite(rawConfidence)) return 0;
  const adj = feedback.byDomain[domain] ?? feedback.overall;
  const adjusted = rawConfidence * (1 + adj);
  if (adjusted <= 0) return 0;
  if (adjusted >= 1) return 1;
  return adjusted;
}

// ---------- independent integrity verification ----------

/**
 * Re-check a report against its raw inputs. Catches:
 *   - flattered_score        — the reported score contradicts the raw ECE
 *                              (a fabricator hiding miscalibration);
 *   - inconsistent_ece       — the reported ECE doesn't match the buckets;
 *   - wrong_feedback_direction — feedback sign contradicts the drift
 *     (overconfident domain reported with a positive adjustment, or vice
 *     versa);
 *   - sample_size_mismatch   — reported sample size doesn't match input rows.
 */
export function verifyCalibration(
  input: RealizedRecommendation[],
  report: CalibrationReport,
): CalibrationVerification {
  const violations: CalibrationViolation[] = [];
  const rows = input.filter(
    (r) =>
      Number.isFinite(r.confidence) &&
      r.confidence >= 0 &&
      r.confidence <= 1 &&
      typeof r.domain === 'string' &&
      r.domain.length > 0,
  );

  if (report.sampleSize !== rows.length) {
    violations.push({
      code: 'sample_size_mismatch',
      detail: `Report sampleSize=${report.sampleSize} but input rows=${rows.length}.`,
    });
  }

  // Recompute overall and compare — a fabricator that overstates the score
  // (e.g. reports 0.9 when the real ECE is 0.6, so real score is 0.4) is
  // caught here. Small numeric drift is tolerated.
  const trueBuckets = buildBuckets(rows);
  const trueEce = computeEce(trueBuckets, rows.length);
  const trueScore = 1 - trueEce;
  if (Math.abs(report.calibrationScore - trueScore) > 1e-6) {
    violations.push({
      code: 'flattered_score',
      detail: `Reported calibrationScore=${round(report.calibrationScore)} but true score=${round(trueScore)} (delta=${round(report.calibrationScore - trueScore)}).`,
    });
  }
  if (Math.abs(report.ece - trueEce) > 1e-6) {
    violations.push({
      code: 'inconsistent_ece',
      detail: `Reported ece=${round(report.ece)} but true ece=${round(trueEce)}.`,
    });
  }

  // Per-domain: verify feedback sign matches drift direction.
  const byDomain = new Map<string, RealizedRecommendation[]>();
  for (const r of rows) {
    const list = byDomain.get(r.domain) ?? [];
    list.push(r);
    byDomain.set(r.domain, list);
  }
  for (const d of report.domains) {
    const domainRows = byDomain.get(d.domain) ?? [];
    if (domainRows.length === 0) continue;
    const meanConf = mean(domainRows.map((r) => r.confidence));
    const meanReal = mean(domainRows.map((r) => (r.realized ? 1 : 0)));
    const drift = meanReal - meanConf; // >0 ⇒ underconfident; <0 ⇒ overconfident
    // Skip near-zero drift (no signal to check).
    if (Math.abs(drift) < 1e-9) continue;
    if (Math.sign(drift) !== Math.sign(d.feedbackAdjustment) && d.feedbackAdjustment !== 0) {
      violations.push({
        code: 'wrong_feedback_direction',
        detail: `Domain "${d.domain}" drift=${round(drift)} (real=${round(meanReal)} vs conf=${round(meanConf)}) but feedbackAdjustment=${round(d.feedbackAdjustment)}.`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

// ---------- helpers ----------

function buildBuckets(rows: RealizedRecommendation[]): CalibrationBucket[] {
  const bins: RealizedRecommendation[][] = Array.from({ length: BUCKET_COUNT }, () => []);
  for (const r of rows) {
    let idx = Math.floor(r.confidence * BUCKET_COUNT);
    if (idx >= BUCKET_COUNT) idx = BUCKET_COUNT - 1;
    if (idx < 0) idx = 0;
    bins[idx]?.push(r);
  }
  return bins
    .map((rows, i): CalibrationBucket => {
      const lower = i / BUCKET_COUNT;
      const upper = (i + 1) / BUCKET_COUNT;
      if (rows.length === 0) {
        return { lower, upper, count: 0, meanConfidence: 0, realizedRate: 0 };
      }
      return {
        lower,
        upper,
        count: rows.length,
        meanConfidence: mean(rows.map((r) => r.confidence)),
        realizedRate: mean(rows.map((r) => (r.realized ? 1 : 0))),
      };
    })
    .filter((b) => b.count > 0);
}

/**
 * Population-weighted mean of |meanConfidence − realizedRate| across buckets.
 * ECE ∈ [0, 1]; 0 = perfect calibration. Empty input ⇒ 0 (no drift observed;
 * the score is 1, honestly reflecting "no evidence of miscalibration").
 */
function computeEce(buckets: CalibrationBucket[], total: number): number {
  if (total === 0) return 0;
  let sum = 0;
  for (const b of buckets) {
    sum += (b.count / total) * Math.abs(b.meanConfidence - b.realizedRate);
  }
  return sum;
}

/**
 * Compute per-domain feedback adjustment.
 *   drift = meanRealized − meanConfidence   (∈ [-1, +1])
 *   adjustment = drift / max(meanConfidence, 1 - meanConfidence, ε)
 * Clamped to [-1, +1]. This SIGN matches drift (overconfident ⇒ negative),
 * and magnitude scales so applying `(1 + adj)` moves the raw confidence
 * TOWARD the realized rate on average — verified by the integrity suite.
 */
function computeFeedbackAdjustment(rows: RealizedRecommendation[]): number {
  if (rows.length === 0) return 0;
  const meanConf = mean(rows.map((r) => r.confidence));
  const meanReal = mean(rows.map((r) => (r.realized ? 1 : 0)));
  const drift = meanReal - meanConf;
  if (Math.abs(drift) < 1e-9) return 0;
  // Scale by whichever side the raw confidence has room to move on.
  const denom = drift < 0 ? Math.max(meanConf, 1e-6) : Math.max(1 - meanConf, 1e-6);
  const adj = drift / denom;
  if (adj < -1) return -1;
  if (adj > 1) return 1;
  return adj;
}

function computeOverallFeedback(report: CalibrationReport): number {
  // Population-weighted mean of per-domain adjustments.
  if (report.sampleSize === 0) return 0;
  let sum = 0;
  for (const d of report.domains) sum += (d.count / report.sampleSize) * d.feedbackAdjustment;
  return sum;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}