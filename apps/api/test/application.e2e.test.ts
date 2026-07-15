/**
 * e2e — /v1/applications over the booted NestJS app against live Postgres.
 * Boots the real app (bootstrap/createApp) with the real Prisma application store,
 * OpportunityExists adapter, and the four-tier MemoryService, then exercises the
 * HTTP boundary end to end. Opportunities + users are seeded directly through
 * Prisma (the same tables the connectors/import paths write).
 *
 * Proves:
 *   - create → `saved` linking an opportunity (+ optional variant) + seeded timeline;
 *   - move through the WHOLE pipeline one legal step at a time; a skip is a 409;
 *   - the CORE invariant over HTTP:
 *       (a) a USER-initiated PATCH with the explicit `iSubmitted` flag → `applied`
 *           SUCCEEDS, stamps appliedAt, appends a `user`-actor timeline row, and
 *           writes an episodic MemoryEvent;
 *       (b) an AGENT/SYSTEM-context PATCH (via `X-Actor`) → `applied` is REJECTED
 *           (403 capability_denied) EVEN with a valid session AND the flag — no
 *           mutation, no MemoryEvent;
 *   - follow-ups schedule an INTERNAL reminder (Green; no external send);
 *   - per-user scoping: user A can neither see nor modify user B's applications;
 *   - auth is required (401 without a bearer token).
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
import { envSchema } from '@careeros/config';
import { buildDepsFromEnv, createApp } from '../src/app/bootstrap.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import { InMemoryObjectStorage } from '../src/common/storage/object-storage.js';
import { BullMqExportQueue } from '../src/common/queue/export-queue.js';
import type { Application, ApplicationDetail, ApplicationFollowUp } from '@careeros/contracts';

// eslint-disable-next-line no-restricted-properties
const RAW_ENV = process.env;
const HAS_INFRA = Boolean(RAW_ENV['DATABASE_URL'] && RAW_ENV['REDIS_URL']);
const d = HAS_INFRA ? describe : describe.skip;

const DEV_SECRET = 'e2e-dev-auth-secret-that-is-at-least-32-chars';
const APPROVAL_SECRET = 'e2e-approval-secret-that-is-at-least-32-chars';

function body<T>(res: { body: unknown }): T {
  return res.body as T;
}

d('M04 /v1/applications over HTTP (booted NestJS app)', () => {
  let app: INestApplication;
  let http: App;
  let prisma: PrismaClient;

  const userA = { id: randomUUID(), email: `a-${randomUUID()}@e2e.test` };
  const userB = { id: randomUUID(), email: `b-${randomUUID()}@e2e.test` };
  let tokenA: string;
  let tokenB: string;

  // A POOL of opportunities: the store enforces UNIQUE (user, opportunity), so each
  // freshly-created application must bind a DISTINCT opportunity. We pop one per create.
  const oppIds: string[] = [];
  let oppId = ''; // the first, used by the single-create assertions
  let nextOpp = 0;
  const createdAppIds: string[] = [];


  beforeAll(async () => {
    const env = envSchema.parse({
      ...RAW_ENV,
      AUTH_PROVIDER: 'dev',
      DEV_AUTH_SECRET: DEV_SECRET,
      APPROVAL_TOKEN_SECRET: APPROVAL_SECRET,
      S3_ENDPOINT: '',
      S3_ACCESS_KEY: '',
      S3_SECRET_KEY: '',
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

    for (const u of [userA, userB]) {
      await prisma.user.create({
        data: { id: u.id, email: u.email, authProviderId: `dev_${u.id.slice(0, 8)}` },
      });
    }

    await prisma.sourceRegistry.upsert({
      where: { key: 'greenhouse' },
      create: { id: randomUUID(), key: 'greenhouse', type: 'ats_public', enabled: true, hosts: [] },
      update: {},
    });

    // Seed a POOL of distinct opportunities (one per application we'll create).
    for (let i = 0; i < 12; i++) {
      const id = randomUUID();
      oppIds.push(id);
      await prisma.opportunity.create({
        data: {
          id,
          source: { connect: { key: 'greenhouse' } },
          sourceRef: `e2e-app-${id.slice(0, 8)}`,
          company: 'Acme Corp',
          role: 'Senior Backend Engineer',
          location: 'Remote - US',
          remote: true,
          requirementsParsed: { requirements: ['Python'] } as never,
          rawPayload: { contentSanitized: 'Senior Backend Engineer.' } as never,
          dedupKey: `e2e-app-dedup-${id.slice(0, 8)}`,
          ingestedAt: new Date(),
        },
      });
    }
    oppId = oppIds[0]!;
    nextOpp = 0;

    tokenA = await DevAuthProvider.mint(userA.id, DEV_SECRET);

    tokenB = await DevAuthProvider.mint(userB.id, DEV_SECRET);
  });

  afterAll(async () => {
    await prisma.applicationFollowUp.deleteMany({ where: { applicationId: { in: createdAppIds } } });
    await prisma.applicationTimelineEntry.deleteMany({ where: { applicationId: { in: createdAppIds } } });
    await prisma.application.deleteMany({ where: { id: { in: createdAppIds } } });
    await prisma.memoryEvent.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
    await prisma.opportunity.deleteMany({ where: { id: { in: oppIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await prisma.$disconnect();
    await app.close();
  });

  /** Create a fresh application for user A and drive it up to (not incl.) `target`. */
  async function createAndAdvance(target: Application['status']): Promise<string> {
    // Each application binds a DISTINCT opportunity (UNIQUE (user, opportunity)).
    const useOpp = oppIds[++nextOpp]!;
    const created = body<ApplicationDetail>(
      await request(http)
        .post('/v1/applications')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ opportunityId: useOpp }),
    );
    createdAppIds.push(created.id);

    // Advance through the canonical pipeline from `saved` up to (not incl.) target.
    const pipeline: Application['status'][] = [
      'saved',
      'drafting',
      'ready',
      'applied',
      'screening',
      'interviewing',
      'offer',
      'closed',
    ];
    const path = pipeline.slice(1, pipeline.indexOf(target));
    for (const step of path) {
      const payload: Record<string, unknown> = { status: step };

      if (step === 'applied') payload.iSubmitted = true;
      const res = await request(http)
        .patch(`/v1/applications/${created.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(payload);
      expect(res.status).toBe(200);
    }
    return created.id;
  }

  it('requires auth → 401 without a bearer token', async () => {
    expect((await request(http).get('/v1/applications')).status).toBe(401);
  });

  it('creates a `saved` application linking the opportunity + seeds the timeline', async () => {
    const res = await request(http)
      .post('/v1/applications')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ opportunityId: oppId, notes: 'dream job' });
    expect(res.status).toBe(201);
    const created = body<ApplicationDetail>(res);
    createdAppIds.push(created.id);
    expect(created.status).toBe('saved');
    expect(created.opportunityId).toBe(oppId);
    expect(created.appliedAt).toBeNull();
    expect(created.timeline).toHaveLength(1);
    expect(created.timeline[0]).toMatchObject({ fromStatus: null, toStatus: 'saved' });
  });

  it('404s a create against an unknown opportunity', async () => {
    const res = await request(http)
      .post('/v1/applications')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ opportunityId: randomUUID() });
    expect(res.status).toBe(404);
  });

  it('moves through the whole pipeline one legal step at a time; a skip is a 409', async () => {
    const id = await createAndAdvance('saved'); // just `saved`

    // A skip (saved → ready) is rejected.
    const skip = await request(http)
      .patch(`/v1/applications/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'ready' });
    expect(skip.status).toBe(409);

    const order: Application['status'][] = [
      'drafting',
      'ready',
      'applied',
      'screening',
      'interviewing',
      'offer',
      'closed',
    ];
    for (const to of order) {
      const payload: Record<string, unknown> = { status: to };
      if (to === 'applied') payload.iSubmitted = true;
      const res = await request(http)
        .patch(`/v1/applications/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(payload);
      expect(res.status).toBe(200);
      expect(body<ApplicationDetail>(res).status).toBe(to);
    }
  });

  it('(a) a USER PATCH with the explicit flag → applied SUCCEEDS, is audited, and writes a MemoryEvent', async () => {
    const id = await createAndAdvance('applied'); // saved → drafting → ready

    const res = await request(http)
      .patch(`/v1/applications/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'applied', iSubmitted: true });
    expect(res.status).toBe(200);
    const detail = body<ApplicationDetail>(res);
    expect(detail.status).toBe('applied');
    expect(detail.appliedAt).not.toBeNull();
    const appliedEntry = detail.timeline.find((t) => t.toStatus === 'applied');
    expect(appliedEntry?.actor).toBe('user');

    // Persisted appliedAt + a durable episodic MemoryEvent for the applied move.
    const row = await prisma.application.findUnique({ where: { id } });
    expect(row?.appliedAt).not.toBeNull();
    const events = await prisma.memoryEvent.findMany({ where: { userId: userA.id } });
    const applyEvent = events.find(
      (e) => (e.payload as Record<string, unknown>)['kind'] === 'application_status_change' &&
        (e.payload as Record<string, unknown>)['toStatus'] === 'applied',
    );
    expect(applyEvent).toBeDefined();
    expect(applyEvent!.type).toBe('user_decision');
  });

  it('(b) an AGENT-context PATCH → applied is REJECTED (403 capability_denied), even with a valid session + the flag', async () => {
    const id = await createAndAdvance('applied'); // move to `ready` legitimately

    for (const actor of ['twin', 'system'] as const) {
      const res = await request(http)
        .patch(`/v1/applications/${id}`)
        .set('Authorization', `Bearer ${tokenA}`) // valid session
        .set('X-Actor', actor) // …but a non-human actor context
        .send({ status: 'applied', iSubmitted: true }); // even asserting the flag
      expect(res.status).toBe(403);
      expect((res.body as { error: { code: string } }).error.code).toBe('capability_denied');
    }

    // No mutation happened: still `ready`, never applied.
    const row = await prisma.application.findUnique({ where: { id } });
    expect(row?.status).toBe('ready');
    expect(row?.appliedAt).toBeNull();
    // No `applied` MemoryEvent was written for this application.
    const events = await prisma.memoryEvent.findMany({ where: { userId: userA.id } });
    const strayApply = events.find(
      (e) => (e.payload as Record<string, unknown>)['applicationId'] === id &&
        (e.payload as Record<string, unknown>)['toStatus'] === 'applied',
    );
    expect(strayApply).toBeUndefined();
  });

  it('schedules an internal follow-up (Green; no external send)', async () => {
    const id = await createAndAdvance('saved');
    const res = await request(http)
      .post(`/v1/applications/${id}/followups`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dueAt: '2026-08-01T09:00:00.000Z', note: 'ping recruiter' });
    expect(res.status).toBe(201);
    const fu = body<ApplicationFollowUp>(res);
    expect(fu.dueAt).toBe('2026-08-01T09:00:00.000Z');
    expect(fu.done).toBe(false);
    // Durably persisted for the caller's application.
    const row = await prisma.applicationFollowUp.findUnique({ where: { id: fu.id } });
    expect(row?.applicationId).toBe(id);
  });

  it('per-user scoping — B cannot see or modify A’s application', async () => {
    const aId = await createAndAdvance('saved');

    // B cannot read A's application.
    expect(
      (await request(http).get(`/v1/applications/${aId}`).set('Authorization', `Bearer ${tokenB}`)).status,
    ).toBe(404);

    // B cannot mutate A's application.
    const patch = await request(http)
      .patch(`/v1/applications/${aId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ status: 'drafting' });
    expect(patch.status).toBe(404);

    // …and A's application is untouched.
    const row = await prisma.application.findUnique({ where: { id: aId } });
    expect(row?.status).toBe('saved');

    // B's list never contains A's application.
    const bList = body<{ data: Application[] }>(
      await request(http).get('/v1/applications').set('Authorization', `Bearer ${tokenB}`),
    );
    expect(bList.data.some((r) => r.id === aId)).toBe(false);
  });
});
