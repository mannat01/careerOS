/**
 * M10 Step 1 — composition-root adapters for confidence calibration.
 *
 * Two seams live here, both keeping @careeros/cie-calibration and
 * @careeros/cie-reasoning free of any @careeros/db import:
 *
 *   1. CalibrationComputeAdapter — implements the handler's
 *      `CalibrationComputePort` by delegating to the deterministic
 *      CalibrationService (which itself reads the caller's REALIZED
 *      recommendations through a narrow RealizedRecommendationPort).
 *
 *   2. CalibrationReasonerFeedbackAdapter — implements the reasoner's
 *      `ReasonerCalibrationPort`. On each decision it recomputes the caller's
 *      calibration feedback and applies the per-domain adjustment so the NEXT
 *      confidence moves TOWARD the realized rate (overconfident ⇒ down). The
 *      loop is honest by construction: the adjustment sign is derived from the
 *      user's OWN realized history, never a flattering constant.
 *
 * PER-USER by construction: every method takes the verified userId; only that
 * user's realized recommendations are ever read.
 */
import {
  CalibrationService,
  applyFeedback,
  type CalibrationFeedback,
  type CalibrationReport,
  type RealizedRecommendation,
  type RealizedRecommendationPort,
} from '@careeros/cie-calibration';
import type { ReasonerCalibrationPort } from '@careeros/cie-reasoning';
import type {
  CalibrationComputePort,
} from './calibration.handlers.js';

/**
 * Adapts the deterministic CalibrationService onto the handler's compute port.
 * The service self-verifies (independent oracle) before returning — a future
 * regression that fabricates a flattering score throws rather than serving it.
 */
export class CalibrationComputeAdapter implements CalibrationComputePort {
  constructor(private readonly service: CalibrationService) {}

  async computeForUser(userId: string): Promise<{
    report: CalibrationReport;
    feedback: CalibrationFeedback;
  }> {
    return this.service.computeForUser(userId);
  }
}

/**
 * Adapts the CalibrationService onto the reasoner's optional calibration seam.
 * Given a raw confidence + domain, returns the calibration-adjusted confidence.
 * Best-effort: if the calibration computation fails for any reason, the raw
 * confidence passes through UNCHANGED (the reasoner's evidence-grounded
 * confidence is never worsened by a calibration outage).
 */
export class CalibrationReasonerFeedbackAdapter implements ReasonerCalibrationPort {
  constructor(private readonly service: CalibrationService) {}

  async adjustConfidence(userId: string, domain: string, rawConfidence: number): Promise<number> {
    try {
      const { feedback } = await this.service.computeForUser(userId);
      return applyFeedback(rawConfidence, domain, feedback);
    } catch {
      return rawConfidence;
    }
  }
}

/**
 * STUB(M10) realized-recommendation port. A persisted Recommendation + outcome
 * store lands in a follow-up; until then this returns NO realized rows, so the
 * report honestly says `sampleSize: 0` (calibrationScore = 1 by the "no
 * evidence of miscalibration" convention) rather than inventing outcomes, and
 * the reasoner feedback is a no-op (adjustment 0). Wiring the Prisma-backed
 * adapter replaces this without touching the service, handler, or reasoner.
 */
export class EmptyRealizedRecommendationPort implements RealizedRecommendationPort {
  readRealized(_userId: string): Promise<RealizedRecommendation[]> {
    return Promise.resolve([]);
  }
}