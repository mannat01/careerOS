
/**
 * e2e — boots the real NestJS app against live Postgres (DATABASE_URL) + Redis
 * (REDIS_URL) with the in-memory ObjectStorage fake (no MinIO needed in CI).
 *
 * Run: pnpm --filter @careeros/api test:integration
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { PrismaClient } from '@careeros/db';
import { mintApprovalToken } from '@careeros/capability-gate';
import { envSchema } from '@careeros/config';
import { buildDepsFromEnv, createApp } from '../src/app/bootstrap.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import { InMemoryObjectStorage } from '../src/common/storage/object-storage.js';
import { BullMqExportQueue } from '../src/common/queue/export-queue.js';
import type { AppDeps } from '../src/app/deps.js';

// e2e fixtures read env directly to decide whether to run (same convention as db integration tests).
// eslint-disable-next-line no-restricted-properties
const RAW_ENV = process.env;
const HAS_INFRA = Boolean(RAW_ENV['DATABASE_URL'] && RAW_ENV['REDIS_URL']);
const d = HAS_INFRA ? describe : describe.skip;

const DEV_SECRET = 'e2e-dev-auth-secret-that-is-at-least-32-chars';
const APPROVAL_SECRET = 'e2e-approval-secret-that-is-at-least-32-chars';

d('M01 /v1/me over HTTP (booted NestJS app)', () => {
  let app: INestApplication;
  let http: App;
  let prisma: PrismaClient;
  let deps: AppDeps;
  let storage: InMemoryObjectStorage;
  let queue: BullMqExportQueue;

  const userA = { id: randomUUID(), email: `a-${randomUUID()}@e2e.test` };
  const userB = { id: randomUUID(), email: `b-${randomUUID()}@e2e.test` };
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    const env = envSchema.parse({
      ...RAW_ENV,
      AUTH_PROVIDER: 'dev',
      DEV_AUTH_SECRET: DEV_SECRET,
      APPROVAL_TOKEN_SECRET: APPROVAL_SECRET,
      // Force the in-memory storage fake (ignore any local MinIO env).
      S3_ENDPOINT: '',
      S3_ACCESS_KEY: '',
      S3_SECRET_KEY: '',
      S3_BUCKET: RAW_ENV['S3_BUCKET'] ?? 'careeros-artifacts',
    });

    storage = new InMemoryObjectStorage();
    queue = new BullMqExportQueue(env.REDIS_URL);
    await queue.drain();

    deps = buildDepsFromEnv(env, { storage, exportQueue: queue });
    app = await createApp(deps);
    await app.init();
    http = app.getHttpServer() as App;

    prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
    for (const u of [userA, userB]) {
      await prisma.user.create({
        data: { id: u.id, email: u.email, authProviderId: `dev_${u.id.slice(0, 8)}` },
      });
    }

    tokenA = await DevAuthProvider.mint(userA.id, DEV_SECRET);
    tokenB = await DevAuthProvider.mint(userB.id, DEV_SECRET);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await queue.close();
    await prisma.$disconnect();
    await app.close();
  });

  // ---------- auth ----------

  it('missing bearer token → 401 unauthenticated', async () => {
    const res = await request(http).get('/v1/me');
    expect(res.status).toBe(401);
  });

  it('invalid bearer token → 401 unauthenticated', async () => {
    const res = await request(http).get('/v1/me').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(401);
  });

  // ---------- happy paths + scoping ----------

  it('GET /v1/me returns the token owner and provisions default settings', async () => {
    const res = await request(http).get('/v1/me').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(userA.id);
    expect(res.body.user.email).toBe(userA.email);
    expect(res.body.settings.userId).toBe(userA.id);
  });

  it("user B's token can never read user A's data (row scope from verified context)", async () => {
    const res = await request(http).get('/v1/me').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(userB.id);
    expect(res.body.user.email).not.toBe(userA.email);
  });

  it('PATCH /v1/me/settings validates and persists a partial update', async () => {
    const res = await request(http)
      .patch('/v1/me/settings')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataUseOptIns: { training: true } });
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(userA.id);
    expect(res.body.dataUseOptIns.training).toBe(true);
  });

  it('PATCH /v1/me/settings rejects an invalid payload with 422', async () => {
    const res = await request(http)
      .patch('/v1/me/settings')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ quietHours: { start: 'not-a-time' } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_failed');
  });

  // ---------- Green: export ----------

  it('POST /v1/me/export enqueues a BullMQ job (Green — allowed, audited)', async () => {
    const before = await queue.waitingCount();
    const res = await request(http).post('/v1/me/export').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('queued');
    expect(res.body.jobId).toBeDefined();
    const after = await queue.waitingCount();
    expect(after).toBe(before + 1);
  });

  // ---------- Yellow: delete ----------

  it('DELETE /v1/me WITHOUT approval token → 403 capability_denied', async () => {
    const res = await request(http).delete('/v1/me').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('capability_denied');
    // User A still exists.
    const still = await prisma.user.findUnique({ where: { id: userA.id } });
    expect(still).not.toBeNull();
  });

  it('DELETE /v1/me WITH a valid token → full cascade (rows + tokens + storage)', async () => {
    // Seed artifacts for both users in the storage fake.
    await storage.put(`${userA.id}/resume.pdf`, 'a-resume');
    await storage.put(`${userA.id}/exports/full.json`, 'a-export');
    await storage.put(`${userB.id}/resume.pdf`, 'b-resume');

    // Mint the Yellow approval token bound to (userA, me.delete, payload=undefined).
    const approval = await mintApprovalToken({
      userId: userA.id,
      action: 'me.delete',
      payload: undefined,
      ttlMs: 60_000,
      secret: APPROVAL_SECRET,
      store: deps.gate.tokenStore,
    });

    const res = await request(http)
      .delete('/v1/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Approval-Token', approval);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    // DB cascade: user, settings, approval tokens, audit rows all gone.
    expect(await prisma.user.findUnique({ where: { id: userA.id } })).toBeNull();
    expect(await prisma.userSettings.findUnique({ where: { userId: userA.id } })).toBeNull();
    expect(await prisma.approvalToken.count({ where: { userId: userA.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { userId: userA.id } })).toBe(0);

    // Storage cascade: user A's artifacts removed; user B's untouched.
    expect(await storage.list(`${userA.id}/`)).toEqual([]);
    expect(await storage.list(`${userB.id}/`)).toHaveLength(1);

    // The consumed single-use token cannot be replayed (user gone → 404 either way,
    // but the gate check comes first: token was consumed + user deleted).
    const replay = await request(http)
      .delete('/v1/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Approval-Token', approval);
    expect(replay.status).toBe(403);
  });
});
