/**
 * e2e — POST /v1/profile/import over the booted NestJS app against live Postgres.
 * Boots the real app (bootstrap/createApp), overrides ONLY the extraction port
 * with a deterministic fake (no network LLM) — the persistence path, Prisma
 * profile upsert, per-user scoping, and HTTP boundary are all exercised for real.
 *
 * Proves: import a resume fixture → entities land in the DB under the caller's
 * profile, and are scoped to the caller (user B's import never appears for A).
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
import type { ParsedEntity } from '@careeros/contracts';
import { buildDepsFromEnv, createApp } from '../src/app/bootstrap.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import { InMemoryObjectStorage } from '../src/common/storage/object-storage.js';
import { BullMqExportQueue } from '../src/common/queue/export-queue.js';
import { type ExtractionPort } from '../src/index.js';

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

/** A realistic multi-kind resume fixture and its verbatim-grounded extraction. */
const RESUME_FIXTURE = [
  'Jordan Rivera',
  '',
  'EXPERIENCE',
  'Senior Backend Engineer, Globex Systems (2020-01 to 2024-06)',
  'Built and scaled payment services handling millions of transactions.',
  '',
  'EDUCATION',
  'B.Sc. Computer Science, State University',
  '',
  'SKILLS',
  'Go, PostgreSQL, distributed systems',
].join('\n');

const FIXTURE_ENTITIES: ParsedEntity[] = [
  {
    kind: 'experience',
    name: 'Globex Systems',
    detail: 'Senior Backend Engineer',
    company: 'Globex Systems',
    title: 'Senior Backend Engineer',
    start: '2020-01',
    end: '2024-06',
    provenance: { source: 'resume', quote: 'Senior Backend Engineer, Globex Systems (2020-01 to 2024-06)' },
  },
  {
    kind: 'education',
    name: 'State University',
    detail: 'B.Sc. Computer Science',
    credential: 'B.Sc. Computer Science',
    provenance: { source: 'resume', quote: 'B.Sc. Computer Science, State University' },
  },
  {
    kind: 'skill',
    name: 'Go',
    detail: 'claimed',
    evidence: 'claimed',
    provenance: { source: 'resume', quote: 'Go, PostgreSQL, distributed systems' },
  },
];

/** Deterministic extractor: returns the fixture extraction for the fixture text. */
class FixtureExtractor implements ExtractionPort {
  extract(resumeText: string): Promise<ParsedEntity[]> {
    return Promise.resolve(resumeText.includes('Globex Systems') ? FIXTURE_ENTITIES : []);
  }
}

d('M02 POST /v1/profile/import over HTTP (booted NestJS app)', () => {
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

    // Build the real deps (real Prisma ProfileRepo) once, then override ONLY the
    // extraction port with the deterministic fixture — persistence stays live.
    const real = buildDepsFromEnv(env, {
      storage: new InMemoryObjectStorage(),
      exportQueue: new BullMqExportQueue(env.REDIS_URL),
    });
    deps = {
      ...real,
      profile: { extractor: new FixtureExtractor(), profiles: real.profile.profiles },
    };

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
    await prisma.$disconnect();
    await app.close();
  });

  it('requires auth → 401 without a bearer token', async () => {
    const res = await request(http).post('/v1/profile/import').send({ resumeText: RESUME_FIXTURE });
    expect(res.status).toBe(401);
  });

  it('imports a resume fixture → entities persisted under the caller, provenance kept', async () => {
    const res = await request(http)
      .post('/v1/profile/import')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ resumeText: RESUME_FIXTURE });

    expect(res.status).toBe(200);
    const out = body<{
      profileId: string;
      counts: { experiences: number; education: number; skillClaims: number };
      entities: Array<{ provenance: { quote: string } }>;
    }>(res);

    expect(out.counts.experiences).toBe(1);
    expect(out.counts.education).toBe(1);
    expect(out.counts.skillClaims).toBe(1);
    // Every persisted entity carries a verbatim quote.
    for (const e of out.entities) {
      expect(RESUME_FIXTURE.includes(e.provenance.quote)).toBe(true);
    }

    // Persisted for real under user A's profile.
    const profile = await prisma.profile.findUnique({ where: { userId: userA.id } });
    expect(profile).not.toBeNull();
    expect(await prisma.experience.count({ where: { profileId: profile!.id } })).toBe(1);
    expect(await prisma.education.count({ where: { profileId: profile!.id } })).toBe(1);
    expect(await prisma.skillClaim.count({ where: { profileId: profile!.id } })).toBe(1);
  });

  it("scopes to the caller — user B's import never appears under user A", async () => {
    await request(http)
      .post('/v1/profile/import')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ resumeText: RESUME_FIXTURE })
      .expect(200);

    const pA = await prisma.profile.findUnique({ where: { userId: userA.id } });
    const pB = await prisma.profile.findUnique({ where: { userId: userB.id } });
    expect(pA!.id).not.toBe(pB!.id);
    // A still has exactly its own single experience — B's write didn't leak in.
    expect(await prisma.experience.count({ where: { profileId: pA!.id } })).toBe(1);
    expect(await prisma.experience.count({ where: { profileId: pB!.id } })).toBe(1);
  });

  it('accepts an already-parsed entities payload (PDF/DOCX parse is STUB(M02))', async () => {
    const res = await request(http)
      .post('/v1/profile/import')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        entities: [
          {
            kind: 'project',
            name: 'OpenLedger',
            detail: 'An open-source ledger',
            provenance: { source: 'resume', quote: 'OpenLedger — an open-source ledger' },
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(body<{ counts: { projects: number } }>(res).counts.projects).toBe(1);
  });

  it('rejects an empty payload → 422', async () => {
    const res = await request(http)
      .post('/v1/profile/import')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});
    expect(res.status).toBe(422);
  });
});
