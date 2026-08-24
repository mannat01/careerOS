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
 * realized recommendations yet, the public response is `insufficient_data`
 * and omits all calibration figures rather than claiming a perfect model.
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
import {
  calibrationResponseSchema,
  type CalibrationResponse,
} from '@careeros/contracts';

// ---------------- port (adapter lives in bootstrap) ----------------

/** Internal calibration result projected structurally; never exposed as the wire shape. */
export interface CalibrationComputation {
  report: {
    sampleSize: number;
    buckets: Array<{
      lower: number;
      upper: number;
      count: number;
      meanConfidence: number;
      realizedRate: number;
    }>;
    ece: number;
    calibrationScore: number;
    domains: Array<{
      domain: string;
      count: number;
      buckets: Array<{
        lower: number;
        upper: number;
        count: number;
        meanConfidence: number;
        realizedRate: number;
      }>;
      ece: number;
      calibrationScore: number;
      feedbackAdjustment: number;
    }>;
    modelVersion: string;
    computedAt: string;
  };
  feedback: {
    byDomain: Record<string, number>;
    overall: number;
    modelVersion: string;
  };
}

/** Computes the caller's internal calibration result behind a narrow service port. */
export interface CalibrationComputePort {
  computeForUser(userId: string): Promise<CalibrationComputation>;
}

export interface CalibrationHandlerDeps {
  calibration: CalibrationComputePort;
}

// ---------------- handler ----------------

/** GET /v1/cie/calibration — the caller's calibration report + evidence. */
export async function getCalibration(
  ctx: RequestContext,
  deps: CalibrationHandlerDeps,
): Promise<HandlerResponse<CalibrationResponse>> {
  try {
    const computation = await deps.calibration.computeForUser(ctx.userId);
    return ok(calibrationResponseSchema.parse(toCalibrationResponse(computation)));
  } catch (err) {
    // The self-verifying service throws only if a future regression breaks the
    // grounding invariants. Surface a clean 500 rather than a fabricated report.
    void err;
    return errorResponse('internal', 'Calibration computation failed.', {
      traceId: ctx.traceId,
    });
  }
}

function toCalibrationResponse(computation: CalibrationComputation): unknown {
  const { report, feedback } = computation;
  if (report.sampleSize === 0) {
    return {
      status: 'insufficient_data',
      report: {
        sampleSize: 0,
        modelVersion: report.modelVersion,
        computedAt: report.computedAt,
      },
      feedback,
    };
  }

  return {
    status: 'measured',
    report: {
      sampleSize: report.sampleSize,
      bins: report.buckets.map(toBucket),
      expectedCalibrationError: report.ece,
      calibrationScore: report.calibrationScore,
      domains: report.domains.map((domain) => ({
        domain: domain.domain,
        sampleSize: domain.count,
        bins: domain.buckets.map(toBucket),
        expectedCalibrationError: domain.ece,
        calibrationScore: domain.calibrationScore,
        feedbackAdjustment: domain.feedbackAdjustment,
      })),
      modelVersion: report.modelVersion,
      computedAt: report.computedAt,
    },
    feedback,
  };
}

function toBucket(bucket: CalibrationComputation['report']['buckets'][number]) {
  return {
    lower: bucket.lower,
    upper: bucket.upper,
    count: bucket.count,
    meanConfidence: bucket.meanConfidence,
    observedAccuracy: bucket.realizedRate,
  };
}
