import { describe, expect, it } from 'vitest';
import { calibrationResponseSchema } from '@careeros/contracts';
import { analyzeCalibration, extractFeedback } from '@careeros/cie-calibration';
import { contextFromVerifiedClaims } from '../src/index.js';
import {
  getCalibration,
  type CalibrationHandlerDeps,
} from '../src/modules/cie/calibration.handlers.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPUTED_AT = new Date('2026-08-24T12:00:00.000Z');
const ctx = contextFromVerifiedClaims({ userId: USER_ID, traceId: 'trace-calibration' });

function depsForRows(rows: Parameters<typeof analyzeCalibration>[0]): CalibrationHandlerDeps {
  return {
    calibration: {
      computeForUser: (userId) => {
        expect(userId).toBe(USER_ID);
        const report = analyzeCalibration(rows, COMPUTED_AT);
        return Promise.resolve({ report, feedback: extractFeedback(report) });
      },
    },
  };
}

describe('GET /v1/cie/calibration handler', () => {
  it('maps internal realized-rate fields to a parsed measured public response', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      id: `recommendation-${index}`,
      domain: 'apply',
      confidence: 0.8,
      realized: index < 6,
    }));

    const result = await getCalibration(ctx, depsForRows(rows));
    expect(result.status).toBe(200);
    if (result.status !== 200) throw new Error('Expected measured calibration response.');
    const body = calibrationResponseSchema.parse(result.body);
    expect(body.status).toBe('measured');
    if (body.status !== 'measured') throw new Error('Expected measured calibration response.');
    expect(body.report.sampleSize).toBe(10);
    expect(body.report.expectedCalibrationError).toBeCloseTo(0.2);
    expect(body.report.calibrationScore).toBeCloseTo(0.8);
    expect(body.report.bins).toHaveLength(1);
    expect(body.report.bins[0]).toMatchObject({
      lower: 0.8,
      upper: 0.9,
      count: 10,
      observedAccuracy: 0.6,
    });
    expect(body.report.bins[0]?.meanConfidence).toBeCloseTo(0.8);
    expect(body).not.toHaveProperty('confidence');
    expect(body.report).not.toHaveProperty('ece');
    expect(body.report.bins[0]).not.toHaveProperty('realizedRate');
  });

  it('maps zero outcomes to insufficient_data without metric figures', async () => {
    const result = await getCalibration(ctx, depsForRows([]));
    expect(result.status).toBe(200);
    if (result.status !== 200) throw new Error('Expected thin calibration response.');
    const body = calibrationResponseSchema.parse(result.body);
    expect(body).toEqual({
      status: 'insufficient_data',
      report: {
        sampleSize: 0,
        modelVersion: 'calibration@1.0.0',
        computedAt: COMPUTED_AT.toISOString(),
      },
      feedback: { byDomain: {}, overall: 0, modelVersion: 'calibration@1.0.0' },
    });
    expect(body.report).not.toHaveProperty('calibrationScore');
    expect(body.report).not.toHaveProperty('expectedCalibrationError');
    expect(body.report).not.toHaveProperty('bins');
  });

  it('returns a typed internal error when an internal result violates the public contract', async () => {
    const invalidDeps = depsForRows([]);
    invalidDeps.calibration.computeForUser = () => Promise.resolve({
      report: {
        sampleSize: 1,
        buckets: [],
        ece: 0,
        calibrationScore: 1,
        domains: [],
        modelVersion: 'calibration@1.0.0',
        computedAt: COMPUTED_AT.toISOString(),
      },
      feedback: { byDomain: {}, overall: 0, modelVersion: 'calibration@1.0.0' },
    });

    const result = await getCalibration(ctx, invalidDeps);
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      error: {
        code: 'internal',
        message: 'Calibration computation failed.',
        traceId: 'trace-calibration',
      },
    });
  });
});