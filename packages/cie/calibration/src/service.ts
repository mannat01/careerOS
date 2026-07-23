/**
 * CalibrationService (M10 Step 1) — orchestrates the calibration analysis
 * behind narrow port(s), never @careeros/db. Reads realized recommendations
 * for a user through RealizedRecommendationPort, runs the deterministic
 * analyzer, self-verifies with the independent oracle, and returns the
 * report + reasoner-facing feedback.
 */
import { analyzeCalibration, extractFeedback, verifyCalibration } from './analyzer.js';
import type {
  CalibrationFeedback,
  CalibrationReport,
  RealizedRecommendation,
} from './model.js';

// ---------- ports ----------

/**
 * Reads REALIZED Recommendations for a user. The composition root adapts the
 * live Recommendation + outcome tables onto this narrow port; the analyzer
 * never touches @careeros/db.
 */
export interface RealizedRecommendationPort {
  readRealized(userId: string): Promise<RealizedRecommendation[]>;
}

export interface CalibrationServiceDeps {
  recommendations: RealizedRecommendationPort;
  now?: () => Date;
}

/**
 * Thrown when the self-verification oracle rejects the analyzer's output —
 * belt-and-suspenders. The deterministic analyzer is grounded by construction
 * so this should never fire in production; it exists to catch a future
 * regression before the report is served.
 */
export class CalibrationIntegrityError extends Error {
  constructor(public readonly violations: string[]) {
    super(`Calibration report failed integrity verification: ${violations.join('; ')}`);
    this.name = 'CalibrationIntegrityError';
  }
}

export class CalibrationService {
  constructor(private readonly deps: CalibrationServiceDeps) {}

  /**
   * Compute the per-user calibration report + reasoner-facing feedback.
   * Per-user scoped by construction (userId flows in, only that user's rows
   * are read).
   */
  async computeForUser(userId: string): Promise<{
    report: CalibrationReport;
    feedback: CalibrationFeedback;
  }> {
    const rows = await this.deps.recommendations.readRealized(userId);
    const now = (this.deps.now ?? (() => new Date()))();
    const report = analyzeCalibration(rows, now);
    const verdict = verifyCalibration(rows, report);
    if (!verdict.ok) {
      throw new CalibrationIntegrityError(verdict.violations.map((v) => v.detail));
    }
    const feedback = extractFeedback(report);
    return { report, feedback };
  }
}