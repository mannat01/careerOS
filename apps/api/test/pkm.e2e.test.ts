import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { PrismaClient } from '@careeros/db';
import { envSchema } from '@careeros/config';
import {
  pkmEntrySchema,
  pkmListResponseSchema,
} from '@careeros/contracts';
import { buildDepsFromEnv, createApp } from '../src/app/bootstrap.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import { InMemoryObjectStorage } from '../src/common/storage/object-storage.js';
import { BullMqExportQueue } from '../src/common/queue/export-queue.js';

// eslint-disable-next-line no-restricted-properties
const RAW_ENV = process.env;
const HAS_INFRA = Boolean(RAW_ENV['DATABASE_URL'] && RAW_ENV['REDIS_URL']);
const d = HAS_INFRA ? describe : describe.skip;
const DEV_SECRET = 'e2e-dev-auth-secret-that-is-at-least-32-chars';
const APPROVAL_SECRET = 'e2e-approval-secret-that-is-at-least-32-chars';

d('/v1/pkm over HTTP and live Postgres', () => {
  let app: INestApplication;
  let http: App;
  let prisma: PrismaClient;
  let tokenA: string;
  let tokenB: string;
  const userA = randomUUID();
  const userB = randomUUID();

  beforeAll(async () => {
    const env = envSchema.parse({
      ...RAW_ENV,
      AUTH_PROVIDER: 'dev',
      DEV_AUTH_SECRET: DEV_SECRET,
      APPROVAL_TOKEN_SECRET: APPROVAL_SECRET,
      S3_ENDPOINT: '', S3_ACCESS_KEY: '', S3_SECRET_KEY: '',
      S3_BUCKET: RAW_ENV['S3_BUCKET'] ?? 'careeros-artifacts',
    });
    const deps = buildDepsFromEnv(env, {
      storage: new InMemoryObjectStorage(),
      exportQueue: new BullMqExportQueue(env.REDIS_URL),
    });
    app = await createApp(deps);
    await app.init();
    http = app.getHttpServer() as App;
    prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
    await prisma.user.createMany({ data: [
      { id: userA, email: `${userA}@pkm.e2e`, authProviderId: `dev_${userA}` },
      { id: userB, email: `${userB}@pkm.e2e`, authProviderId: `dev_${userB}` },
    ] });
    [tokenA, tokenB] = await Promise.all([
      DevAuthProvider.mint(userA, DEV_SECRET),
      DevAuthProvider.mint(userB, DEV_SECRET),
    ]);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await prisma.$disconnect();
    await app.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('runs CRUD, keeps provenance user, and writes mutation MemoryEvents', async () => {
    const create = await request(http).post('/v1/pkm').set(auth(tokenA)).send({
      title: 'Architecture note', body: 'Prefer reversible migrations.', tags: ['Platform'],
    });
    expect(create.status).toBe(201);
    const entry = pkmEntrySchema.parse(create.body);
    expect(entry).toMatchObject({ userId: userA, tags: ['platform'], provenance: 'user' });

    const list = await request(http).get('/v1/pkm').set(auth(tokenA));
    expect(list.status).toBe(200);
    expect(pkmListResponseSchema.parse(list.body).data.map((row) => row.id)).toContain(entry.id);

    const get = await request(http).get(`/v1/pkm/${entry.id}`).set(auth(tokenA));
    expect(get.status).toBe(200);
    expect(pkmEntrySchema.parse(get.body).id).toBe(entry.id);

    const patch = await request(http).patch(`/v1/pkm/${entry.id}`).set(auth(tokenA)).send({
      title: 'Updated architecture note', tags: ['Postgres'],
    });
    expect(patch.status).toBe(200);
    expect(pkmEntrySchema.parse(patch.body)).toMatchObject({
      id: entry.id, userId: userA, title: 'Updated architecture note', tags: ['postgres'], provenance: 'user',
    });

    const del = await request(http).delete(`/v1/pkm/${entry.id}`).set(auth(tokenA));
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ id: entry.id, deleted: true });
    expect((await request(http).get(`/v1/pkm/${entry.id}`).set(auth(tokenA))).status).toBe(404);

    const events = await prisma.memoryEvent.findMany({ where: { userId: userA }, orderBy: { occurredAt: 'asc' } });
    expect(events.map((event) => (event.payload as { action?: string }).action)).toEqual(['created', 'updated', 'deleted']);
    expect(events.every((event) => event.type === 'user_decision' && event.autonomyTier === 'green')).toBe(true);
  });

  it('returns 404 for wrong-owner GET/PATCH/DELETE without mutation or audit', async () => {
    const created = await request(http).post('/v1/pkm').set(auth(tokenA)).send({ title: 'Private', body: 'Owner only' });
    const entry = pkmEntrySchema.parse(created.body);
    const beforeB = await prisma.memoryEvent.count({ where: { userId: userB } });
    expect((await request(http).get(`/v1/pkm/${entry.id}`).set(auth(tokenB))).status).toBe(404);
    expect((await request(http).patch(`/v1/pkm/${entry.id}`).set(auth(tokenB)).send({ title: 'Stolen' })).status).toBe(404);
    expect((await request(http).delete(`/v1/pkm/${entry.id}`).set(auth(tokenB))).status).toBe(404);
    expect(await prisma.memoryEvent.count({ where: { userId: userB } })).toBe(beforeB);
    expect((await request(http).get(`/v1/pkm/${entry.id}`).set(auth(tokenA))).status).toBe(200);
  });

  it.each(['userId', 'provenance'])('rejects client %s on POST and PATCH', async (field) => {
    const create = await request(http).post('/v1/pkm').set(auth(tokenA)).send({
      title: 'Rejected', body: 'Rejected', [field]: field === 'userId' ? userB : 'imported',
    });
    expect(create.status).toBe(422);
    const owned = await prisma.pkmEntry.create({ data: { userId: userA, title: 'Owned', body: 'Body', provenance: 'user' } });
    const patch = await request(http).patch(`/v1/pkm/${owned.id}`).set(auth(tokenA)).send({
      title: 'Rejected', [field]: field === 'userId' ? userB : 'imported',
    });
    expect(patch.status).toBe(422);
    const unchanged = await prisma.pkmEntry.findUniqueOrThrow({ where: { id: owned.id } });
    expect(unchanged).toMatchObject({ userId: userA, title: 'Owned', provenance: 'user' });
  });

  it.each([
    ['POST empty title/body', () => request(http).post('/v1/pkm').set(auth(tokenA)).send({ title: '', body: '' })],
    ['PATCH empty body', () => request(http).patch(`/v1/pkm/${randomUUID()}`).set(auth(tokenA)).send({})],
    ['GET malformed id', () => request(http).get('/v1/pkm/not-a-uuid').set(auth(tokenA))],
    ['GET unknown query', () => request(http).get('/v1/pkm?userId=someone').set(auth(tokenA))],
  ])('returns validation_failed for %s', async (_name, send) => {
    const response = await send();
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ error: { code: 'validation_failed' } });
  });
});