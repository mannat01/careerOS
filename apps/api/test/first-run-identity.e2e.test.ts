import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import {
  CONSERVATIVE_AUTONOMY_DEFAULTS,
  DEV_USER_ID,
  meResponseSchema,
  type ApiError,
  type MeResponse,
} from '@careeros/contracts';
import { mintApprovalToken } from '@careeros/capability-gate';
import { envSchema } from '@careeros/config';
import { PrismaClient } from '@careeros/db';
import { buildDepsFromEnv, createApp } from '../src/app/bootstrap.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import { InMemoryObjectStorage } from '../src/common/storage/object-storage.js';
import { BullMqExportQueue } from '../src/common/queue/export-queue.js';
import type { AppDeps } from '../src/app/deps.js';

// Existing CI convention: DATABASE_URL + REDIS_URL make this suite mandatory.
// eslint-disable-next-line no-restricted-properties
const RAW_ENV = process.env;
const HAS_INFRA = Boolean(RAW_ENV['DATABASE_URL'] && RAW_ENV['REDIS_URL']);
const d = HAS_INFRA ? describe : describe.skip;
const DEV_SECRET = 'first-run-dev-auth-secret-that-is-at-least-32-chars';
const APPROVAL_SECRET = 'first-run-approval-secret-that-is-at-least-32-chars';

function responseBody<T>(response: { body: unknown }): T {
  return response.body as T;
}

d('FM2 Step 0 first-run identity over HTTP + real Postgres', () => {
  let app: INestApplication;
  let http: App;
  let prisma: PrismaClient;
  let deps: AppDeps;
  let queue: BullMqExportQueue;
  const principalA = randomUUID();
  const principalB = randomUUID();
  const existingId = randomUUID();
  const cleanupIds = [principalA, principalB, existingId];
  let tokenA: string;
  let tokenB: string;
  let existingToken: string;

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
    deps = buildDepsFromEnv(env, {
      storage: new InMemoryObjectStorage(),
      exportQueue: queue,
    });
    app = await createApp(deps);
    await app.init();
    http = app.getHttpServer() as App;
    prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
    await prisma.user.deleteMany({ where: { id: { in: cleanupIds } } });
    await prisma.user.create({
      data: {
        id: existingId,
        email: `existing-${existingId}@e2e.test`,
        authProviderId: `dev|${existingId}`,
        subscriptionTier: 'pro',
        status: 'suspended',
        onboardingCompletedAt: new Date('2026-01-01T00:00:00.000Z'),
        settings: {
          create: {
            autonomyDefaults: { 'resume.tailor': 'yellow' },
            quietHours: { start: '23:00', end: '06:00', timezone: 'UTC' },
            sourcePrefs: { greenhouse: false },
            dataUseOptins: { training: false, crossUserIntel: false },
          },
        },
      },
    });
    tokenA = await DevAuthProvider.mint(principalA, DEV_SECRET, `a-${principalA}@e2e.test`);
    tokenB = await DevAuthProvider.mint(principalB, DEV_SECRET, `b-${principalB}@e2e.test`);
    existingToken = await DevAuthProvider.mint(existingId, DEV_SECRET, 'ignored@e2e.test');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: cleanupIds } } });
    await queue.close();
    await prisma.$disconnect();
    await app.close();
  });

  it('missing account is 404, concurrent bootstrap creates exactly one user/settings', async () => {
    const missing = await request(http).get('/v1/me').set('Authorization', `Bearer ${tokenA}`);
    expect(missing.status).toBe(404);
    expect(responseBody<ApiError>(missing).error.code).toBe('not_found');
    for (const path of ['/v1/applications', '/v1/audit']) {
      const empty = await request(http).get(path).set('Authorization', `Bearer ${tokenA}`);
      expect(empty.status).toBe(200);
      expect(responseBody<{ data: unknown[] }>(empty).data).toEqual([]);
    }

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => request(http)
        .post('/v1/me/bootstrap')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ userId: principalB, onboarding: { status: 'complete' } })),
    );
    const parsed = responses.map((response) => {
      expect(response.status).toBe(200);
      return meResponseSchema.parse(response.body);
    });
    expect(new Set(parsed.map((me) => me.user.id))).toEqual(new Set([principalA]));
    expect(parsed.every((me) => me.onboarding.status === 'required')).toBe(true);
    for (const me of parsed) {
      expect(me.settings.autonomyDefaults).toEqual(CONSERVATIVE_AUTONOMY_DEFAULTS);
    }
    expect(await prisma.user.count({ where: { id: principalA } })).toBe(1);
    expect(await prisma.userSettings.count({ where: { userId: principalA } })).toBe(1);

    const read = await request(http).get('/v1/me').set('Authorization', `Bearer ${tokenA}`);
    expect(read.status).toBe(200);
    expect(responseBody<MeResponse>(read).onboarding.status).toBe('required');
  });

  it('second principal is isolated and missing profile/state are typed 404s', async () => {
    const bootstrapB = await request(http)
      .post('/v1/me/bootstrap')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(bootstrapB.status).toBe(200);
    expect(responseBody<MeResponse>(bootstrapB).user.id).toBe(principalB);
    expect(responseBody<MeResponse>(bootstrapB).user.id).not.toBe(principalA);

    for (const path of ['/v1/profile', '/v1/cie/state']) {
      const response = await request(http).get(path).set('Authorization', `Bearer ${tokenB}`);
      expect(response.status).toBe(404);
      expect(responseBody<ApiError>(response).error.code).toBe('not_found');
    }

    const latest = await request(http)
      .get('/v1/briefings/latest')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(latest.status).toBe(404);
    expect(responseBody<ApiError>(latest).error.code).toBe('not_found');

    for (const path of ['/v1/applications', '/v1/audit']) {
      const response = await request(http).get(path).set('Authorization', `Bearer ${tokenB}`);
      expect(response.status).toBe(200);
      expect(responseBody<{ data: unknown[] }>(response).data).toEqual([]);
    }
  });

  it('existing complete suspended account and settings remain byte-for-byte unchanged', async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: existingId }, include: { settings: true },
    });
    const response = await request(http)
      .post('/v1/me/bootstrap')
      .set('Authorization', `Bearer ${existingToken}`);
    expect(response.status).toBe(200);
    expect(responseBody<MeResponse>(response).user.status).toBe('suspended');
    expect(responseBody<MeResponse>(response).onboarding.status).toBe('complete');
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: existingId }, include: { settings: true },
    });
    expect(after).toEqual(before);
  });

  it('hard delete cascades dependents; later bootstrap creates a clean account only', async () => {
    const profile = await prisma.profile.create({ data: { userId: principalA, headline: 'must disappear' } });
    await prisma.experience.create({
      data: {
        profileId: profile.id, company: 'Old Co', title: 'Old data', skills: [], provenance: 'user',
      },
    });
    const crossUser = await request(http)
      .get('/v1/profile')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(crossUser.status).toBe(404);
    const approval = await mintApprovalToken({
      userId: principalA,
      action: 'me.delete',
      payload: undefined,
      ttlMs: 60_000,
      secret: APPROVAL_SECRET,
      store: deps.gate.tokenStore,
    });
    const deleted = await request(http)
      .delete('/v1/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Approval-Token', approval);
    expect(deleted.status).toBe(200);
    expect(await prisma.profile.findUnique({ where: { id: profile.id } })).toBeNull();

    const recreated = await request(http)
      .post('/v1/me/bootstrap')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(recreated.status).toBe(200);
    expect(responseBody<MeResponse>(recreated).onboarding.status).toBe('required');
    expect(await prisma.profile.findUnique({ where: { userId: principalA } })).toBeNull();
    expect(await prisma.userSettings.count({ where: { userId: principalA } })).toBe(1);
  });

  it('canonical seeded user remains explicitly complete', async () => {
    const seeded = await prisma.user.findUnique({ where: { id: DEV_USER_ID } });
    expect(seeded?.onboardingCompletedAt).toEqual(new Date('2026-01-06T05:59:00.000Z'));
  });
});