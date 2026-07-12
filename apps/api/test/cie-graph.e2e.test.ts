/**
 * e2e — GET /v1/cie/graph over the booted NestJS app against live Postgres.
 * Boots the real app (bootstrap/createApp) with the real PrismaGraphStore-backed
 * GraphMemoryService, seeds each user's Career Knowledge Graph directly through
 * the service (the same code path the app uses), then exercises the HTTP boundary.
 *
 * Proves:
 *   - a seeded fixture profile builds a connected graph readable over HTTP,
 *   - a depth-2 query from a skill node returns the expected neighborhood,
 *   - reads are PER-USER scoped: user A cannot read user B's graph (a B node id
 *     404s for A; A's listing never contains B's nodes),
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
import { PrismaGraphStore } from '@careeros/db';
import { GraphMemoryService, FakeEmbedder, type GraphProfileInput } from '@careeros/memory';
import { envSchema } from '@careeros/config';
import { buildDepsFromEnv, createApp } from '../src/app/bootstrap.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import { InMemoryObjectStorage } from '../src/common/storage/object-storage.js';
import { BullMqExportQueue } from '../src/common/queue/export-queue.js';
import type { AppDeps } from '../src/app/deps.js';

// eslint-disable-next-line no-restricted-properties
const RAW_ENV = process.env;
const HAS_INFRA = Boolean(RAW_ENV['DATABASE_URL'] && RAW_ENV['REDIS_URL']);
const d = HAS_INFRA ? describe : describe.skip;

const DEV_SECRET = 'e2e-dev-auth-secret-that-is-at-least-32-chars';
const APPROVAL_SECRET = 'e2e-approval-secret-that-is-at-least-32-chars';

function body<T>(res: { body: unknown }): T {
  return res.body as T;
}

const FIXTURE: GraphProfileInput = {
  personLabel: 'Ada Lovelace',
  experiences: [
    { company: 'Acme Corp', title: 'Senior Engineer', skills: ['TypeScript', 'PostgreSQL'] },
    { company: 'Globex', title: 'Staff Engineer', skills: ['TypeScript', 'Kubernetes'] },
  ],
  projects: [{ name: 'Nightscout', skills: ['TypeScript', 'React'] }],
  education: [{ institution: 'MIT', credential: 'BSc', field: 'Computer Science' }],
  skills: [{ name: 'TypeScript' }, { name: 'Leadership' }],
};

interface GraphNodeDto {
  id: string;
  kind: string;
  label: string;
}
interface GraphResponse {
  nodes: GraphNodeDto[];
  edges: Array<{ id: string; fromNodeId: string; toNodeId: string; type: string }>;
}

d('M02 GET /v1/cie/graph over HTTP (booted NestJS app)', () => {
  let app: INestApplication;
  let http: App;
  let prisma: PrismaClient;
  let deps: AppDeps;

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
      S3_ENDPOINT: '',
      S3_ACCESS_KEY: '',
      S3_SECRET_KEY: '',
      S3_BUCKET: RAW_ENV['S3_BUCKET'] ?? 'careeros-artifacts',
    });

    deps = buildDepsFromEnv(env, {
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

    // Seed each user's graph through the SAME service path the app uses.
    const graph = new GraphMemoryService(new PrismaGraphStore(prisma), new FakeEmbedder());
    await graph.upsertFromProfile(userA.id, FIXTURE);
    graph.clearUpsertCache();
    await graph.upsertFromProfile(userB.id, { ...FIXTURE, personLabel: 'Grace Hopper' });

    tokenA = await DevAuthProvider.mint(userA.id, DEV_SECRET);
    tokenB = await DevAuthProvider.mint(userB.id, DEV_SECRET);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('requires auth → 401 without a bearer token', async () => {
    const res = await request(http).get('/v1/cie/graph');
    expect(res.status).toBe(401);
  });

  it('lists the caller\'s connected graph (no node param)', async () => {
    const res = await request(http)
      .get('/v1/cie/graph')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    const out = body<GraphResponse>(res);
    // person + 3 companies + 1 project + 2 experience anchors + 5 skills.
    expect(out.nodes.length).toBeGreaterThanOrEqual(10);
    expect(out.nodes.some((n) => n.kind === 'person' && n.label === 'Ada Lovelace')).toBe(true);
  });

  it('depth-2 from a skill node returns the expected neighborhood', async () => {
    // Find A's TypeScript node id via the listing.
    const list = body<GraphResponse>(
      await request(http).get('/v1/cie/graph').set('Authorization', `Bearer ${tokenA}`),
    );
    const ts = list.nodes.find((n) => n.kind === 'skill' && n.label === 'TypeScript')!;
    expect(ts).toBeDefined();

    const d1 = body<GraphResponse>(
      await request(http)
        .get(`/v1/cie/graph?node=${ts.id}&depth=1`)
        .set('Authorization', `Bearer ${tokenA}`),
    );
    const d1Labels = new Set(d1.nodes.map((n) => n.label));
    expect(d1Labels.has('PostgreSQL')).toBe(false); // 2 hops away

    const d2res = await request(http)
      .get(`/v1/cie/graph?node=${ts.id}&depth=2`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(d2res.status).toBe(200);
    const d2 = body<GraphResponse>(d2res);
    const d2Labels = new Set(d2.nodes.map((n) => n.label));
    expect(d2Labels.has('PostgreSQL')).toBe(true);
    expect(d2Labels.has('Kubernetes')).toBe(true);
    expect(d2Labels.has('React')).toBe(true);
    expect(d2.nodes.length).toBeGreaterThan(d1.nodes.length);
    expect(d2.edges.length).toBeGreaterThan(0);
  });

  it('is PER-USER scoped — user A cannot read user B\'s graph', async () => {
    // Grab a B node id (as B).
    const bList = body<GraphResponse>(
      await request(http).get('/v1/cie/graph').set('Authorization', `Bearer ${tokenB}`),
    );
    const bPerson = bList.nodes.find((n) => n.kind === 'person')!;
    expect(bPerson.label).toBe('Grace Hopper');

    // As A, that B node id is NOT FOUND (404) — no cross-user read.
    const asA = await request(http)
      .get(`/v1/cie/graph?node=${bPerson.id}&depth=2`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(asA.status).toBe(404);

    // And A's own listing never contains any of B's node ids.
    const aList = body<GraphResponse>(
      await request(http).get('/v1/cie/graph').set('Authorization', `Bearer ${tokenA}`),
    );
    const bIds = new Set(bList.nodes.map((n) => n.id));
    expect(aList.nodes.every((n) => !bIds.has(n.id))).toBe(true);
  });
});
