import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { App } from 'supertest/types.js';
import {
  analyzeCalibration,
  extractFeedback,
  type RealizedRecommendation,
} from '@careeros/cie-calibration';
import { calibrationResponseSchema } from '@careeros/contracts';
import { CieController } from '../src/app/cie.controller.js';
import { BearerAuthGuard } from '../src/app/bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from '../src/app/deps.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import type { CalibrationHandlerDeps } from '../src/modules/cie/calibration.handlers.js';

const AUTH_SECRET = 'calibration-e2e-auth-secret-that-is-at-least-32-chars';
const COMPUTED_AT = new Date('2026-08-24T12:00:00.000Z');

@Module({})
class TestCalibrationModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return {
      module: TestCalibrationModule,
      controllers: [CieController],
      providers: [{ provide: APP_DEPS, useValue: deps }, BearerAuthGuard],
    };
  }
}

describe('FM6.7-pre GET /v1/cie/calibration', () => {
  let app: INestApplication;
  let http: App;
  const measuredUser = randomUUID();
  const thinUser = randomUUID();
  const requestedUserIds: string[] = [];
  let measuredToken: string;
  let thinToken: string;

  beforeAll(async () => {
    const rowsByUser = new Map<string, RealizedRecommendation[]>([
      [measuredUser, Array.from({ length: 10 }, (_, index) => ({
        id: `recommendation-${index}`,
        domain: 'apply',
        confidence: 0.8,
        realized: index < 6,
      }))],
      [thinUser, []],
    ]);
    const calibration: CalibrationHandlerDeps = {
      calibration: {
        computeForUser: (userId) => {
          requestedUserIds.push(userId);
          const report = analyzeCalibration(rowsByUser.get(userId) ?? [], COMPUTED_AT);
          return Promise.resolve({ report, feedback: extractFeedback(report) });
        },
      },
    };
    const deps = {
      authProvider: new DevAuthProvider(AUTH_SECRET),
      calibration,
    } as unknown as AppDeps;

    app = await NestFactory.create(TestCalibrationModule.forRoot(deps), {
      logger: ['warn', 'error'],
    });
    await app.init();
    http = app.getHttpServer() as App;
    [measuredToken, thinToken] = await Promise.all([
      DevAuthProvider.mint(measuredUser, AUTH_SECRET),
      DevAuthProvider.mint(thinUser, AUTH_SECRET),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns parsed measured reliability data for the authenticated caller', async () => {
    const response = await request(http)
      .get('/v1/cie/calibration')
      .set('Authorization', `Bearer ${measuredToken}`);

    expect(response.status).toBe(200);
    const body = calibrationResponseSchema.parse(response.body);
    expect(body.status).toBe('measured');
    if (body.status !== 'measured') throw new Error('Expected measured calibration response.');
    expect(body.report.sampleSize).toBe(10);
    expect(body.report.bins[0]).toMatchObject({
      count: 10,
      observedAccuracy: 0.6,
    });
    expect(body.report.bins[0]?.meanConfidence).toBeCloseTo(0.8);
    expect(requestedUserIds.at(-1)).toBe(measuredUser);
  });

  it('returns insufficient_data without figures for a caller with no outcomes', async () => {
    const response = await request(http)
      .get('/v1/cie/calibration')
      .set('Authorization', `Bearer ${thinToken}`);

    expect(response.status).toBe(200);
    const body = calibrationResponseSchema.parse(response.body);
    expect(body.status).toBe('insufficient_data');
    expect(body.report).toEqual({
      sampleSize: 0,
      modelVersion: 'calibration@1.0.0',
      computedAt: COMPUTED_AT.toISOString(),
    });
    expect(requestedUserIds.at(-1)).toBe(thinUser);
  });

  it('requires verified authentication before computing calibration', async () => {
    const callsBefore = requestedUserIds.length;
    await request(http).get('/v1/cie/calibration').expect(401);
    expect(requestedUserIds).toHaveLength(callsBefore);
  });
});