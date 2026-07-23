/**
 * M10 Step 1 — Confidence-calibration endpoint (Green, per-user scoped).
 *
 *   GET /v1/cie/calibration → the caller's calibration report + the evidence
 *                             behind it (per-domain bucket tables) + the
 *                             reasoner-facing feedback signal.
 *
 * HONEST BY CONSTRUCTION: the deterministic CalibrationService bins the
 * caller's REALIZED recommendations by stated confidence, computes ECE, and
 * self-verifies. A poorly-calibrated (overconfident) set yields a LOW score —
 * the endpoint never returns a flattering number. When the caller has no
 * realized recommendations yet, `sampleSize` is 0 and the report says so
 * plainly rather than claiming a perfect model.
 *
 * PER-USER by construction: `userId` flows from the verified RequestContext;
 * the service reads ONLY that user's realized recommendations through the
 * RealizedRecommendationPort — cross-user data is never reachable.
 *
 * DB-free: the handler depends on a narrow service port; the Prisma-backed
 * RealizedRecommendationPort adapter lives in the composition root.
 */
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';
import type { CalibrationFeedback, CalibrationReport } from '@careeros/cie-calibration';

// ---------------- port (adapter lives in bootstrap) ----------------

/**
 * Computes the per-user calibration report + reasoner feedback. Backed by the
 * CalibrationService in @careeros/cie-calibration.
 */
export interface CalibrationComputePort {
  computeForUser(userId: string): Promise<{
    report: CalibrationReport;
    feedback: CalibrationFeedback;
  }>;
}

export interface CalibrationHandlerDeps {
  calibration: CalibrationComputePort;
}

// ---------------- response shape ----------------

export interface CalibrationResponse {
  report: CalibrationReport;
  feedback: CalibrationFeedback;
}

// ---------------- handler ----------------

/** GET /v1/cie/calibration — the caller's calibration report + evidence. */
export async function getCalibration(
  ctx: RequestContext,
  deps: CalibrationHandlerDeps,
): Promise<HandlerResponse<CalibrationResponse>> {
  try {
    const { report, feedback } = await deps.calibration.computeForUser(ctx.userId);
    return ok({ report, feedback });
  } catch (err) {
    // The self-verifying service throws only if a future regression breaks the
    // grounding invariants. Surface a clean 500 rather than a fabricated report.
    void err;
    return errorResponse('internal', 'Calibration computation failed.', {
      traceId: ctx.traceId,
    });
  }
}