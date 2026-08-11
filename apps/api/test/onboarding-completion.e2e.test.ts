import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { envSchema } from '@careeros/config';
import {
  apiErrorSchema,
  meResponseSchema,
  onboardingCompletionResponseSchema,
} from '@careeros/contracts';
import { PrismaClient } from '@careeros/db';
import { buildDepsFromEnv, createApp } from '../src/app/bootstrap.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import { InMemoryObjectStorage } from '../src/common/storage/object-storage.js';
import { BullMqExportQueue } from '../src/common/queue/export-queue.js';

// eslint-disable-next-line no-restricted-properties
const RAW_ENV = process.env;
const HAS_INFRA = Boolean(RAW_ENV['DATABASE_URL'] && RAW_ENV['REDIS_URL']);
const d = HAS_INFRA ? describe : describe.skip;
const DEV_SECRET = 'completion-dev-auth-secret-that-is-at-least-32-chars';
const APPROVAL_SECRET = 'completion-approval-secret-that-is-at-least-32-chars';

d('FM2.3 onboarding completion over HTTP + real Postgres', () => {
  let app: INestApplication;
  let http: App;
  let prisma: PrismaClient;
  let queue: BullMqExportQueue;
  const userA = randomUUID();
  const userB = randomUUID();
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    const env = envSchema.parse({
      ...RAW_ENV,
      AUTH_PROVIDER: 'dev',
      DEV_AUTH_SECRET: DEV_SECRET,
      APPROVAL_TOKEN_SECRET: APPROVAL_SECRET,
      S3_ENDPOINT: '', S3_ACCESS_KEY: '', S3_SECRET_KEY: '',
      S3_BUCKET: RAW_ENV['S3_BUCKET'] ?? 'careeros-artifacts',
    });
    queue = new BullMqExportQueue(env.REDIS_URL);
    const deps = buildDepsFromEnv(env, {
      storage: new InMemoryObjectStorage(),
      exportQueue: queue,
    });
    app = await createApp(deps);
    await app.init();
    http = app.getHttpServer() as App;
    prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
    await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    tokenA = await DevAuthProvider.mint(userA, DEV_SECRET, `a-${userA}@e2e.test`);
    tokenB = await DevAuthProvider.mint(userB, DEV_SECRET, `b-${userB}@e2e.test`);
    for (const token of [tokenA, tokenB]) {
      const bootstrap = await request(http)
        .post('/v1/me/bootstrap')
        .set('Authorization', `Bearer ${token}`);
      expect(bootstrap.status).toBe(200);
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await prisma.$disconnect();
    await app.close();
    await queue.close();
  });

  it('returns typed 409 when the caller has no imported fact', async () => {
    const response = await request(http)
      .post('/v1/me/onboarding/complete')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});
    expect(response.status).toBe(409);
    expect(apiErrorSchema.parse(response.body).error).toMatchObject({
      code: 'conflict',
      message: 'Import a résumé first.',
      details: { prerequisite: 'profile_with_imported_fact' },
    });
  });

  it('completes the caller, emits one MemoryEvent, and remains idempotent', async () => {
    const profile = await prisma.profile.create({ data: { userId: userA } });
    await prisma.skillClaim.create({
      data: {
        profileId: profile.id,
        skill: 'TypeScript',
        level: 'intermediate',
        provenance: 'imported',
      },
    });

    const first = await request(http)
      .post('/v1/me/onboarding/complete')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});
    const parsedFirst = onboardingCompletionResponseSchema.parse(first.body);
    expect(first.status).toBe(200);
    expect(parsedFirst.onboarding.status).toBe('complete');
    expect(parsedFirst.user.id).toBe(userA);

    const second = await request(http)
      .post('/v1/me/onboarding/complete')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});
    const parsedSecond = onboardingCompletionResponseSchema.parse(second.body);
    expect(second.status).toBe(200);
    expect(parsedSecond.onboarding.completedAt).toBe(parsedFirst.onboarding.completedAt);
    expect(await prisma.memoryEvent.count({
      where: {
        userId: userA,
        type: 'user_decision',
        payload: { path: ['kind'], equals: 'onboarding_completed' },
      },
    })).toBe(1);

    const getMe = await request(http).get('/v1/me').set('Authorization', `Bearer ${tokenA}`);
    expect(meResponseSchema.parse(getMe.body).onboarding).toEqual(parsedFirst.onboarding);
  });

  it("is per-user scoped: A's profile cannot complete B", async () => {
    const response = await request(http)
      .post('/v1/me/onboarding/complete')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ userId: userA });
    expect(response.status).toBe(422);
    const cleanRetry = await request(http)
      .post('/v1/me/onboarding/complete')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({});
    expect(cleanRetry.status).toBe(409);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userB } });
    expect(user.onboardingCompletedAt).toBeNull();
    expect(await prisma.memoryEvent.count({ where: { userId: userB } })).toBe(0);
  });
});