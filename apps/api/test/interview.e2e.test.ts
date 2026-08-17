import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { App } from 'supertest/types.js';
import {
  DebrieferAgent,
  InterviewPrepService,
  groundInterviewPrep,
  type InterviewPrepAgent,
  type InterviewPrepInput,
  type JobDescription,
  type ProfileFact,
} from '@careeros/cie-interview';
import { interviewPrepResponseSchema } from '@careeros/contracts';
import { InterviewController } from '../src/app/interview.controller.js';
import { BearerAuthGuard } from '../src/app/bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from '../src/app/deps.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import type { InterviewPrepHandlerDeps } from '../src/modules/cie/interview.handlers.js';

const AUTH_SECRET = 'interview-e2e-auth-secret-that-is-at-least-32-chars';
const OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000061';
const UNKNOWN_OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000099';
const JOB: JobDescription = {
  title: 'Senior Backend Engineer',
  requirements: ['TypeScript services', 'Kubernetes'],
  text: 'Build TypeScript services and operate Kubernetes workloads.',
};

@Module({})
class TestInterviewModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return {
      module: TestInterviewModule,
      controllers: [InterviewController],
      providers: [{ provide: APP_DEPS, useValue: deps }, BearerAuthGuard],
    };
  }
}

class GuardedFixtureAgent implements InterviewPrepAgent {
  prepare(input: InterviewPrepInput) {
    return Promise.resolve(groundInterviewPrep({ questions: [], answers: [] }, input));
  }
}

describe('FM6.1-pre POST /v1/cie/interview/prep', () => {
  let app: INestApplication;
  let http: App;
  const userA = randomUUID();
  const userB = randomUUID();
  const thinUser = randomUUID();
  const profileByUser = new Map<string, ProfileFact[]>([
    [userA, [{ id: 'experience:typescript', kind: 'experience', summary: 'Built reliable TypeScript services.' }]],
    [userB, [{ id: 'experience:other', kind: 'experience', summary: 'Built Python data tools.' }]],
    [thinUser, []],
  ]);
  const storedByUser = new Map<string, Set<string>>([
    [userA, new Set([OPPORTUNITY_ID])],
    [thinUser, new Set([OPPORTUNITY_ID])],
  ]);
  let tokenA: string;
  let tokenB: string;
  let thinToken: string;

  beforeAll(async () => {
    const service = new InterviewPrepService({
      profile: { readProfileFacts: (userId) => Promise.resolve(profileByUser.get(userId) ?? []) },
      state: { readStateDimensions: () => Promise.resolve([]) },
      graph: { readGraph: () => Promise.resolve([]) },
      opportunities: {
        readOpportunity: (_userId, opportunityId) => {
          if (opportunityId !== OPPORTUNITY_ID) return Promise.reject(new Error('unknown opportunity'));
          return Promise.resolve(JOB);
        },
      },
      evidence: {
        readAllowedFactRefs: (userId) =>
          Promise.resolve((profileByUser.get(userId) ?? []).map((fact) => fact.id)),
      },
      agent: new GuardedFixtureAgent(),
      debriefer: new DebrieferAgent(),
      memory: { appendMemoryEvent: () => Promise.resolve() },
    });
    const interview: InterviewPrepHandlerDeps = {
      service,
      opportunities: {
        exists: (opportunityId) => Promise.resolve(opportunityId === OPPORTUNITY_ID),
        isStoredByUser: (userId, opportunityId) =>
          Promise.resolve(storedByUser.get(userId)?.has(opportunityId) ?? false),
      },
    };
    const deps = {
      authProvider: new DevAuthProvider(AUTH_SECRET),
      interview,
    } as unknown as AppDeps;

    app = await NestFactory.create(TestInterviewModule.forRoot(deps), { logger: ['warn', 'error'] });
    await app.init();
    http = app.getHttpServer() as App;
    [tokenA, tokenB, thinToken] = await Promise.all([
      DevAuthProvider.mint(userA, AUTH_SECRET),
      DevAuthProvider.mint(userB, AUTH_SECRET),
      DevAuthProvider.mint(thinUser, AUTH_SECRET),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns post-guardrail questions grounded in the real opportunity and profile facts', async () => {
    const response = await request(http)
      .post('/v1/cie/interview/prep')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ opportunityId: OPPORTUNITY_ID });

    expect(response.status).toBe(200);
    const body = interviewPrepResponseSchema.parse(response.body);
    expect(body.status).toBe('ready');
    if (body.status !== 'ready') throw new Error('Expected ready interview prep.');
    expect(body.questions.length).toBeGreaterThan(0);
    expect(body.questions[0]?.grounding).toMatchObject({
      opportunityId: OPPORTUNITY_ID,
      requirements: [JOB.requirements[0]],
      profileFactRefs: ['experience:typescript'],
    });
    expect(body.questions[0]?.suggestedAnswer.evidence).toEqual([
      { claim: 'real work related to TypeScript services', factRef: 'experience:typescript' },
    ]);
    expect(response.body).not.toHaveProperty('rawProposal');
  });

  it('returns insufficient_data for a caller with a thin profile', async () => {
    const response = await request(http)
      .post('/v1/cie/interview/prep')
      .set('Authorization', `Bearer ${thinToken}`)
      .send({ opportunityId: OPPORTUNITY_ID });

    expect(response.status).toBe(200);
    expect(interviewPrepResponseSchema.parse(response.body)).toMatchObject({
      status: 'insufficient_data',
      opportunityId: OPPORTUNITY_ID,
    });
  });

  it('denies an existing opportunity not stored in the caller pipeline', async () => {
    const response = await request(http)
      .post('/v1/cie/interview/prep')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ opportunityId: OPPORTUNITY_ID });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: {
        code: 'capability_denied',
        details: { opportunityId: OPPORTUNITY_ID, reason: 'opportunity_not_owned' },
      },
    });
  });

  it('returns 404 for an unknown opportunity before checking ownership', async () => {
    const response = await request(http)
      .post('/v1/cie/interview/prep')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ opportunityId: UNKNOWN_OPPORTUNITY_ID });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: { code: 'not_found', details: { opportunityId: UNKNOWN_OPPORTUNITY_ID } },
    });
  });
});