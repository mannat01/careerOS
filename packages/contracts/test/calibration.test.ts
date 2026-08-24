import { describe, expect, it } from 'vitest';
import { calibrationResponseSchema } from '../src/index.js';

const MODEL_VERSION = 'calibration@1.0.0';
const COMPUTED_AT = '2026-08-24T12:00:00.000Z';

describe('GET /v1/cie/calibration contract', () => {
  it('strictly parses measured reliability data and its feedback', () => {
    const response = {
      status: 'measured' as const,
      report: {
        sampleSize: 10,
        bins: [{ lower: 0.8, upper: 0.9, count: 10, meanConfidence: 0.85, observedAccuracy: 0.6 }],
        expectedCalibrationError: 0.25,
        calibrationScore: 0.75,
        domains: [{
          domain: 'apply',
          sampleSize: 10,
          bins: [{ lower: 0.8, upper: 0.9, count: 10, meanConfidence: 0.85, observedAccuracy: 0.6 }],
          expectedCalibrationError: 0.25,
          calibrationScore: 0.75,
          feedbackAdjustment: -0.29411764705882354,
        }],
        modelVersion: MODEL_VERSION,
        computedAt: COMPUTED_AT,
      },
      feedback: {
        byDomain: { apply: -0.29411764705882354 },
        overall: -0.29411764705882354,
        modelVersion: MODEL_VERSION,
      },
    };

    expect(calibrationResponseSchema.parse(response)).toEqual(response);
    expect(calibrationResponseSchema.safeParse({ ...response, confidence: 0.9 }).success).toBe(false);
    expect(calibrationResponseSchema.safeParse({
      ...response,
      report: { ...response.report, sampleSize: 9 },
    }).success).toBe(false);
  });

  it('represents no outcome history without fabricated calibration figures', () => {
    const response = {
      status: 'insufficient_data' as const,
      report: { sampleSize: 0, modelVersion: MODEL_VERSION, computedAt: COMPUTED_AT },
      feedback: { byDomain: {}, overall: 0 as const, modelVersion: MODEL_VERSION },
    };

    expect(calibrationResponseSchema.parse(response)).toEqual(response);
    expect(response.report).not.toHaveProperty('expectedCalibrationError');
    expect(response.report).not.toHaveProperty('calibrationScore');
    expect(response.report).not.toHaveProperty('bins');
    expect(calibrationResponseSchema.safeParse({
      ...response,
      report: { ...response.report, calibrationScore: 1 },
    }).success).toBe(false);
  });
});