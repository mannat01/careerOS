import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { App } from 'supertest/types.js';
import { planSetResponseSchema } from '@careeros/contracts';
import { CieController } from '../src/app/cie.controller.js';
import { BearerAuthGuard } from '../src/app/bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from '../src/app/deps.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import type { PlanHandlerDeps } from '../src/modules/cie/plan.handlers.js';

const AUTH_SECRET = 'plan-e2e-auth-secret-that-is-at-least-32-characters';
const NOW = '2026-08-17T12:00:00.000Z';

@Module({})
class TestPlanModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return {
      module: TestPlanModule,
      controllers: [CieController],
      providers: [{ provide: APP_DEPS, useValue: deps }, BearerAuthGuard],
    };
  }
}

describe('FM6.2-pre GET /v1/cie/plans public contract', () => {
  let app: INestApplication;
  let http: App;
  const populatedUser = randomUUID();
  const emptyUser = randomUUID();
  let populatedToken: string;
  let emptyToken: string;
  const observedUserIds: string[] = [];

  beforeAll(async () => {
    const persistedPlan = {
      id: 'persisted-plan-30d',
      horizon: '30d' as const,
      status: 'active' as const,
      summary: 'Advance the caller-stated platform goal.',
      goalRefs: ['goal:career_goals:0'],
      diffSummary: null,
      rationale: 'Initial plan generation.',
      modelVersion: 'strategic-planner@1.0.0',
      supersededById: null,
      createdAt: NOW,
      updatedAt: NOW,
      actions: [{
        id: 'persisted-action-1',
        actionKey: 'internal-action-key',
        kind: 'project' as const,
        title: 'Complete the grounded reliability project.',
        rationale: 'The project and goal both resolve in caller state.',
        orderIndex: 0,
        status: 'suggested' as const,
        progress: 0,
        evidenceRefs: ['goal:career_goals:0', 'node:project:reliability'],
      }],
    };

    const plan = {
      store: {
        getActivePlans: (userId: string) => {
          observedUserIds.push(userId);
          return Promise.resolve(userId === populatedUser ? [persistedPlan] : []);
        },
      },
    } as unknown as PlanHandlerDeps;
    const deps = {
      authProvider: new DevAuthProvider(AUTH_SECRET),
      plan,
    } as unknown as AppDeps;

    app = await NestFactory.create(TestPlanModule.forRoot(deps), { logger: ['warn', 'error'] });
    await app.init();
    http = app.getHttpServer() as App;
    [populatedToken, emptyToken] = await Promise.all([
      DevAuthProvider.mint(populatedUser, AUTH_SECRET),
      DevAuthProvider.mint(emptyUser, AUTH_SECRET),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a schema-valid grounded projection without DB-only fields', async () => {
    const response = await request(http)
      .get(`/v1/cie/plans?userId=${encodeURIComponent(emptyUser)}`)
      .set('Authorization', `Bearer ${populatedToken}`);

    expect(response.status).toBe(200);
    const body = planSetResponseSchema.parse(response.body);
    expect(body.status).toBe('ready');
    if (body.status !== 'ready') throw new Error('Expected a ready plan response.');
    expect(observedUserIds.at(-1)).toBe(populatedUser);
    expect(body.plans[0]).toMatchObject({
      id: 'persisted-plan-30d',
      goalRefs: ['goal:career_goals:0'],
      modelVersion: 'strategic-planner@1.0.0',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(body.plans[0]?.actions[0]?.evidenceRefs).toEqual([
      'goal:career_goals:0',
      'node:project:reliability',
    ]);
    const publicPlan = body.plans[0]!;
    const publicAction = publicPlan.actions[0]!;
    expect(publicPlan).not.toHaveProperty('status');
    expect(publicPlan).not.toHaveProperty('supersededById');
    expect(publicPlan).not.toHaveProperty('confidence');
    expect(publicAction).not.toHaveProperty('actionKey');
    expect(publicAction).not.toHaveProperty('orderIndex');
    expect(publicAction).not.toHaveProperty('confidence');
  });

  it('returns the honest insufficient_data shape for a caller with no active plan', async () => {
    const response = await request(http)
      .get('/v1/cie/plans')
      .set('Authorization', `Bearer ${emptyToken}`);

    expect(response.status).toBe(200);
    expect(observedUserIds.at(-1)).toBe(emptyUser);
    expect(planSetResponseSchema.parse(response.body)).toEqual({
      status: 'insufficient_data',
      plans: [],
      todaysMove: null,
      reason: 'No active plan is available yet.',
    });
  });

  it('requires a verified bearer subject', async () => {
    const response = await request(http).get('/v1/cie/plans');
    expect(response.status).toBe(401);
  });
});