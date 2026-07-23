/**
 * M10 Step 1 — Confidence calibration: data contract.
 *
 * The calibration analyzer answers ONE question honestly: when the CIE stamped
 * a Recommendation with a confidence of `c`, did outcomes actually land at
 * rate `c`? A poorly-calibrated set (e.g. "I'm 90% sure" but only 30% of
 * those recommendations panned out) yields a POOR score — NEVER a flattering
 * one. This is the A1.7 model-quality guardrail (PRD §7.4/A1.7).
 *
 * The feedback signal is a per-domain SIGNED adjustment the reasoner applies
 * to future confidences: overconfident domains get pushed DOWN; underconfident
 * domains get nudged UP. Its direction is provable (see the integrity suite).
 */

export const CALIBRATION_MODEL_VERSION = 'calibration@1.0.0';

/**
 * One stored Recommendation joined with its REALIZED outcome. `confidence` is
 * what the CIE stamped at recommendation time; `realized` is what actually
 * happened (true = the recommendation was correct / the recommended action
 * produced the intended result). `domain` groups by strategic area (e.g.
 * 'apply', 'wait', 'negotiate', 'skill-plan') so per-domain drift is visible.
 */
export interface RealizedRecommendation {
  id: string;
  domain: string;
  /** Stated confidence in [0,1] at recommendation time. */
  confidence: number;
  /** True iff the recommendation's stated outcome was realized. */
  realized: boolean;
}

/** One confidence bucket + the observed reality inside it. */
export interface CalibrationBucket {
  /** Lower bin edge, inclusive. */
  lower: number;
  /** Upper bin edge, exclusive (inclusive for the top bucket). */
  upper: number;
  /** How many recommendations fell in this bucket. */
  count: number;
  /** Mean stated confidence of the recommendations in this bucket. */
  meanConfidence: number;
  /** Fraction of recommendations in this bucket that were realized. */
  realizedRate: number;
}

/** Per-domain slice with its own buckets, ECE, and feedback signal. */
export interface DomainCalibration {
  domain: string;
  count: number;
  buckets: CalibrationBucket[];
  /**
   * Expected Calibration Error in [0,1]. 0 = perfectly calibrated; 1 = worst
   * case. The population-weighted mean of |meanConfidence − realizedRate|
   * across buckets.
   */
  ece: number;
  /**
   * Calibration score in [0,1] = 1 − ECE. HONEST: overconfident sets score
   * LOW here; well-calibrated sets score HIGH. Never flatters the model.
   */
  calibrationScore: number;
  /**
   * Signed feedback adjustment in [-1, +1]. NEGATIVE ⇒ future confidences in
   * this domain should DROP (the model was overconfident); POSITIVE ⇒ future
   * confidences should RISE (the model was underconfident). The reasoner
   * multiplies its raw confidence by (1 + adjustment) and clamps to [0,1].
   */
  feedbackAdjustment: number;
}

/**
 * The full calibration report — the payload GET /v1/cie/calibration returns.
 * `overall` aggregates all domains. `evidence` carries per-domain bucket
 * tables so the report SHOWS ITS WORK (never a bare score).
 */
export interface CalibrationReport {
  /** Total realized recommendations analyzed. */
  sampleSize: number;
  /** Overall (all-domain) buckets. */
  buckets: CalibrationBucket[];
  /** Overall Expected Calibration Error. */
  ece: number;
  /** Overall calibration score = 1 − ECE. */
  calibrationScore: number;
  /** Per-domain slices — the evidence behind the overall score. */
  domains: DomainCalibration[];
  /** Model + method version stamp. */
  modelVersion: string;
  /** ISO timestamp the report was computed. */
  computedAt: string;
}

/**
 * The feedback signal the reasoner consumes: per-domain SIGNED adjustment
 * in [-1, +1]. Applying `(1 + adjustment)` and clamping to [0,1] MOVES the
 * next confidence TOWARD the observed realized rate — the direction is
 * proven by the integrity suite.
 */
export interface CalibrationFeedback {
  /** Domain → signed adjustment in [-1, +1]. */
  byDomain: Record<string, number>;
  /** Fallback adjustment for domains not present at recommendation time. */
  overall: number;
  modelVersion: string;
}

/** One integrity violation found by the independent verifier. */
export interface CalibrationViolation {
  code:
    | 'flattered_score'
    | 'inconsistent_ece'
    | 'wrong_feedback_direction'
    | 'sample_size_mismatch';
  detail: string;
}

/** Verifier verdict: ok=true iff the report faithfully reflects the inputs. */
export interface CalibrationVerification {
  ok: boolean;
  violations: CalibrationViolation[];
}