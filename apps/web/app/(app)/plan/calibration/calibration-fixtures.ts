import {
  calibrationResponseSchema,
  type CalibrationResponse,
} from '@careeros/contracts';

const MODEL_VERSION = 'calibration@fake-deterministic';
const COMPUTED_AT = '2026-08-24T12:00:00.000Z';

export const MEASURED_CALIBRATION: CalibrationResponse = calibrationResponseSchema.parse({
  status: 'measured',
  report: {
    sampleSize: 20,
    bins: [
      { lower: 0.4, upper: 0.5, count: 10, meanConfidence: 0.45, observedAccuracy: 0.5 },
      { lower: 0.8, upper: 0.9, count: 10, meanConfidence: 0.85, observedAccuracy: 0.6 },
    ],
    expectedCalibrationError: 0.15,
    calibrationScore: 0.85,
    domains: [
      {
        domain: 'apply',
        sampleSize: 10,
        bins: [{ lower: 0.8, upper: 0.9, count: 10, meanConfidence: 0.85, observedAccuracy: 0.6 }],
        expectedCalibrationError: 0.25,
        calibrationScore: 0.75,
        feedbackAdjustment: -0.29411764705882354,
      },
      {
        domain: 'wait',
        sampleSize: 10,
        bins: [{ lower: 0.4, upper: 0.5, count: 10, meanConfidence: 0.45, observedAccuracy: 0.5 }],
        expectedCalibrationError: 0.05,
        calibrationScore: 0.95,
        feedbackAdjustment: 0.09090909090909088,
      },
    ],
    modelVersion: MODEL_VERSION,
    computedAt: COMPUTED_AT,
  },
  feedback: {
    byDomain: { apply: -0.29411764705882354, wait: 0.09090909090909088 },
    overall: -0.10160427807486633,
    modelVersion: MODEL_VERSION,
  },
});

export const INSUFFICIENT_CALIBRATION: CalibrationResponse = calibrationResponseSchema.parse({
  status: 'insufficient_data',
  report: { sampleSize: 0, modelVersion: MODEL_VERSION, computedAt: COMPUTED_AT },
  feedback: { byDomain: {}, overall: 0, modelVersion: MODEL_VERSION },
});