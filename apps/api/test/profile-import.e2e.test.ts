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
import { PrismaClient, PrismaProfileReader } from '@careeros/db';
import { envSchema } from '@careeros/config';
import type { ParsedEntity } from '@careeros/contracts';
import {
  CareerStateService,
  InMemoryStateStore,
  type DerivedDimension,
  type StateModelAgent,
  type StateProfileFact,
} from '@careeros/cie-state';
import { buildDepsFromEnv, createApp } from '../src/app/bootstrap.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import { InMemoryObjectStorage } from '../src/common/storage/object-storage.js';
import { BullMqExportQueue } from '../src/common/queue/export-queue.js';
import { type ExtractionPort } from '../src/index.js';
import {
  MemoryStateEvidenceAdapter,
  MemoryStateFactAdapter,
  type StateHandlerDeps,
} from '../src/index.js';

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

/** Deterministic model used only to prove recompute reads the corrected DB fact. */
class ProfileEchoStateAgent implements StateModelAgent {
  derive(profile: StateProfileFact[]): Promise<DerivedDimension[]> {
    const skills = profile.filter((fact) => fact.kind === 'skill');
    return Promise.resolve([
      {
        dimension: 'demonstrated_skills',
        values: skills.map((skill) => skill.summary),
        confidence: skills.length > 0 ? 0.8 : 0,
        evidenceRefs: skills.map((skill) => skill.id),
      },
    ]);
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

    prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
    const profileReader = new PrismaProfileReader(prisma);
    const state: StateHandlerDeps = {
      service: new CareerStateService({
        facts: new MemoryStateFactAdapter(profileReader),
        evidence: new MemoryStateEvidenceAdapter(profileReader),
        store: new InMemoryStateStore(),
        events: { recordStateEvent: () => Promise.resolve() },
        agent: new ProfileEchoStateAgent(),
      }),
    };

    // Keep real Prisma profile + memory ports; replace only network-model seams.
    const real = buildDepsFromEnv(env, {
      storage: new InMemoryObjectStorage(),
      exportQueue: new BullMqExportQueue(env.REDIS_URL),
    });
    deps = {
      ...real,
      profile: { ...real.profile, extractor: new FixtureExtractor() },
      state,
    };

    app = await createApp(deps);

    await app.init();
    http = app.getHttpServer() as App;

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

  it('edits an owned fact with provenance=user and appends a user_decision MemoryEvent', async () => {
    const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: userA.id } });
    const skill = await prisma.skillClaim.findFirstOrThrow({ where: { profileId: profile.id } });

    const res = await request(http)
      .patch(`/v1/profile/facts/${skill.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ kind: 'skill', label: 'PostgreSQL corrected' });

    expect(res.status).toBe(200);
    expect(body<{ fact: { label: string; provenance: string } }>(res).fact)
      .toMatchObject({ label: 'PostgreSQL corrected', provenance: 'user' });
    const persisted = await prisma.skillClaim.findUniqueOrThrow({ where: { id: skill.id } });
    expect(persisted.skill).toBe('PostgreSQL corrected');
    expect(persisted.provenance).toBe('user');

    const events = await prisma.memoryEvent.findMany({
      where: { userId: userA.id, type: 'user_decision' },
      orderBy: { occurredAt: 'desc' },
    });
    const editEvent = events.find((event) => {
      const payload = event.payload as Record<string, unknown>;
      return payload.kind === 'profile_fact_edit' && payload.factId === skill.id;
    });
    expect(editEvent).toBeDefined();
    expect((editEvent!.payload as Record<string, unknown>).provenance).toBe('user');
  });

  it('supports authoritative label corrections for experience, project, and education', async () => {
    const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: userA.id } });
    const experience = await prisma.experience.findFirstOrThrow({ where: { profileId: profile.id } });
    const education = await prisma.education.findFirstOrThrow({ where: { profileId: profile.id } });
    const project = await prisma.project.create({
      data: {
        profileId: profile.id,
        name: 'Old project name',
        skills: [],
        provenance: 'imported',
      },
    });
    const cases = [
      { id: experience.id, kind: 'experience', label: 'Principal Backend Engineer' },
      { id: project.id, kind: 'project', label: 'Corrected project name' },
      { id: education.id, kind: 'education', label: 'B.Sc. in Computer Science' },
    ] as const;

    for (const edit of cases) {
      const res = await request(http)
        .patch(`/v1/profile/facts/${edit.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ kind: edit.kind, label: edit.label });
      expect(res.status).toBe(200);
      expect(body<{ fact: { label: string; provenance: string } }>(res).fact)
        .toMatchObject({ label: edit.label, provenance: 'user' });
    }

    expect(await prisma.experience.findUniqueOrThrow({ where: { id: experience.id } }))
      .toMatchObject({ title: 'Principal Backend Engineer', provenance: 'user' });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: project.id } }))
      .toMatchObject({ name: 'Corrected project name', provenance: 'user' });
    expect(await prisma.education.findUniqueOrThrow({ where: { id: education.id } }))
      .toMatchObject({ credential: 'B.Sc. in Computer Science', provenance: 'user' });
  });

  it("hides another user's fact and leaves it unchanged", async () => {
    const profileB = await prisma.profile.findUniqueOrThrow({ where: { userId: userB.id } });
    const skillB = await prisma.skillClaim.findFirstOrThrow({ where: { profileId: profileB.id } });
    const before = { skill: skillB.skill, provenance: skillB.provenance };

    await request(http)
      .patch(`/v1/profile/facts/${skillB.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ kind: 'skill', label: 'Cross-user overwrite' })
      .expect(404);

    const after = await prisma.skillClaim.findUniqueOrThrow({ where: { id: skillB.id } });
    expect({ skill: after.skill, provenance: after.provenance }).toEqual(before);
  });

  it('state recompute re-reads and reflects the corrected authoritative fact', async () => {
    const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: userA.id } });
    const skill = await prisma.skillClaim.findFirstOrThrow({
      where: { profileId: profile.id, skill: 'PostgreSQL corrected' },
    });

    const recomputed = await request(http)
      .post('/v1/cie/state/recompute')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ factId: `skill:${skill.id}`, reason: 'user corrected skill' });

    expect(recomputed.status).toBe(200);
    const state = body<{ dimensions: Array<{ dimension: string; value: { values: string[] }; evidenceRefs: string[] }> }>(recomputed);
    const skills = state.dimensions.find((dimension) => dimension.dimension === 'demonstrated_skills');
    expect(skills?.value.values).toContain('PostgreSQL corrected (intermediate)');
    expect(skills?.evidenceRefs).toContain(`skill:${skill.id}`);
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
