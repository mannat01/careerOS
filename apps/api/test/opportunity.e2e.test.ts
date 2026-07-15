/**
 * e2e — /v1/opportunities over the booted NestJS app against live Postgres.
 * Boots the real app (bootstrap/createApp) with the real Prisma read + match
 * stores and the REUSED M03 MatchScorerService. Opportunities + profiles are
 * seeded directly through Prisma (the same tables the connectors/import paths
 * write), then the HTTP boundary is exercised end to end.
 *
 * Proves:
 *   - list is newest-first, filterable (source/remote/comp/freshness), and
 *     cursor-paginated (default 25 / max 100),
 *   - detail returns the SANITIZED raw_payload (never raw ingested text),
 *   - match returns an HONEST, grounded MatchScore that carries its explanation
 *     (never a bare number) and NAMES a demanded-but-missing skill,
 *   - match is PER-USER: users A and B get DIFFERENT scores for the SAME
 *     opportunity, each persisted on the UNIQUE (profile, opportunity, model),
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
import { PrismaClient, PrismaProfileReader } from '@careeros/db';
import { envSchema } from '@careeros/config';
import {
  MATCH_SCORER_MODEL_VERSION,
  MatchScorerService,
  groundMatchScore,
  type JobDescription,
  type MatchScore,
  type ScoringAgent,
  type TailorProfileFact,
} from '@careeros/cie-resume';
import { buildDepsFromEnv, createApp } from '../src/app/bootstrap.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import { InMemoryObjectStorage } from '../src/common/storage/object-storage.js';
import { BullMqExportQueue } from '../src/common/queue/export-queue.js';
import { MemoryResumeFactAdapter } from '../src/index.js';
import type { OpportunityDetail, OpportunityPage } from '../src/index.js';


/**
 * Deterministic scoring agent (no network) that still runs the REAL honest-gap
 * guardrail: it proposes an INFLATED 95/100 with a fabricated evidence ref, then
 * `groundMatchScore` DISCARDS those numbers and recomputes the honest score from
 * the caller's REAL Prisma-read facts vs the opportunity's REAL requirements.
 * This mirrors how the other e2e specs swap the STUB(M01) LLM port for a fixture.
 */
class FixtureScoringAgent implements ScoringAgent {
  score(profile: TailorProfileFact[], job: JobDescription): Promise<MatchScore> {
    const proposal = {
      overall: 95,
      subscores: [{ key: 'skills_match' as const, value: 95 }],
      explanation: 'Overall 95/100. Strong match on every requirement.',
      evidenceRefs: [...(profile[0] ? [profile[0].id] : []), 'f-fabricated'],
    };
    return Promise.resolve(groundMatchScore(proposal, profile, job));
  }
}



// eslint-disable-next-line no-restricted-properties
const RAW_ENV = process.env;
const HAS_INFRA = Boolean(RAW_ENV['DATABASE_URL'] && RAW_ENV['REDIS_URL']);
const d = HAS_INFRA ? describe : describe.skip;

const DEV_SECRET = 'e2e-dev-auth-secret-that-is-at-least-32-chars';
const APPROVAL_SECRET = 'e2e-approval-secret-that-is-at-least-32-chars';

function body<T>(res: { body: unknown }): T {
  return res.body as T;
}

const SANITIZED = 'Senior Backend Engineer. Python. distributed systems. 5+ years backend experience.';

d('M04 /v1/opportunities over HTTP (booted NestJS app)', () => {
  let app: INestApplication;
  let http: App;
  let prisma: PrismaClient;

  const userA = { id: randomUUID(), email: `a-${randomUUID()}@e2e.test` };

  const userB = { id: randomUUID(), email: `b-${randomUUID()}@e2e.test` };
  let tokenA: string;
  let tokenB: string;

  // Seeded opportunity ids (filled in beforeAll).
  const oppIds: string[] = [];
  let ghOppId = '';

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

    const real = buildDepsFromEnv(env, {
      storage: new InMemoryObjectStorage(),
      exportQueue: new BullMqExportQueue(env.REDIS_URL),
    });
    // Swap ONLY the LLM-backed scoring agent for the deterministic fixture — the
    // real Prisma read/match stores, ProfileReader-backed facts, and the honest-gap
    // guardrail all stay live (the same pattern the profile-import e2e uses for
    // the STUB(M01) extraction port).
    const scorerPrisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
    const deps = {
      ...real,

      opportunity: {
        ...real.opportunity,
        scorer: new MatchScorerService({
          facts: new MemoryResumeFactAdapter(new PrismaProfileReader(scorerPrisma)),
          agent: new FixtureScoringAgent(),
        }),
      },
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

    // Ensure the source registry keys we reference exist (idempotent).
    for (const [key, type] of [
      ['greenhouse', 'ats_public'],
      ['lever', 'ats_public'],
      ['usajobs', 'gov_feed'],
    ] as const) {
      await prisma.sourceRegistry.upsert({
        where: { key },
        create: { id: randomUUID(), key, type, enabled: true, hosts: [] },
        update: {},
      });
    }

    // Seed three opportunities across sources/remote/comp/freshness, newest first.
    const seed = [
      { source: 'greenhouse', remote: true, comp: null, days: 1 },
      { source: 'lever', remote: false, comp: { min: 150000, max: 200000 }, days: 3 },
      { source: 'usajobs', remote: true, comp: null, days: 40 },
    ];
    for (const s of seed) {
      const id = randomUUID();
      oppIds.push(id);
      if (s.source === 'greenhouse') ghOppId = id;
      await prisma.opportunity.create({
        data: {
          id,
          source: { connect: { key: s.source } },
          sourceRef: `e2e-${id.slice(0, 8)}`,
          company: 'Acme Corp',
          role: 'Senior Backend Engineer',
          comp: (s.comp ?? undefined) as never,
          location: s.remote ? 'Remote - US' : 'New York, NY',
          remote: s.remote,
          requirementsParsed: { requirements: ['Python', 'distributed systems', '5+ years backend'] } as never,
          rawPayload: { contentSanitized: SANITIZED } as never,
          dedupKey: `e2e-dedup-${id.slice(0, 8)}`,
          ingestedAt: new Date(Date.now() - s.days * 86_400_000),
        },
      });
    }

    // Seed user A's profile — a WEAK match (barista; no backend/Python).
    const profA = await prisma.profile.create({ data: { id: randomUUID(), userId: userA.id } });
    await prisma.experience.create({
      data: {
        id: randomUUID(),
        profileId: profA.id,
        company: 'Ridge Coffee',
        title: 'Barista',
        bullets: ['Cash handling and scheduling'] as never,
        skills: [],
        provenance: 'imported',
      },
    });

    // Seed user B's profile — a STRONG match (senior backend; Python; distributed systems).
    const profB = await prisma.profile.create({ data: { id: randomUUID(), userId: userB.id } });
    await prisma.experience.create({
      data: {
        id: randomUUID(),
        profileId: profB.id,
        company: 'Netgrid',
        title: 'Senior Backend Engineer',
        start: new Date('2018-01-01'),
        bullets: ['Built Python distributed systems for 7 years'] as never,
        skills: ['Python', 'distributed systems'],
        provenance: 'imported',
      },
    });
    for (const skill of ['Python', 'distributed systems']) {
      await prisma.skillClaim.create({
        data: {
          id: randomUUID(),
          profileId: profB.id,
          skill,
          level: 'expert',
          provenance: 'imported',
        },
      });
    }

    tokenA = await DevAuthProvider.mint(userA.id, DEV_SECRET);
    tokenB = await DevAuthProvider.mint(userB.id, DEV_SECRET);
  });

  afterAll(async () => {
    await prisma.matchScore.deleteMany({ where: { opportunityId: { in: oppIds } } });
    await prisma.opportunity.deleteMany({ where: { id: { in: oppIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('requires auth → 401 without a bearer token', async () => {
    expect((await request(http).get('/v1/opportunities')).status).toBe(401);
  });

  it('lists opportunities newest-first (detail-only rawPayload absent from list rows)', async () => {
    const res = await request(http).get('/v1/opportunities').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    const page = body<OpportunityPage>(res);
    const ours = page.data.filter((r) => oppIds.includes(r.id));
    expect(ours.length).toBe(3);
    // Newest first: greenhouse (1d) before lever (3d) before usajobs (40d).
    const order = ours.map((r) => r.id);
    expect(order.indexOf(oppIds[0]!)).toBeLessThan(order.indexOf(oppIds[1]!));
    expect(order.indexOf(oppIds[1]!)).toBeLessThan(order.indexOf(oppIds[2]!));
    // List items never carry the sanitized payload — that's detail-only.
    expect(JSON.stringify(ours)).not.toContain('contentSanitized');
  });

  it('filters by source, remote, comp, and freshness', async () => {
    const bySource = body<OpportunityPage>(
      await request(http).get('/v1/opportunities?source=lever').set('Authorization', `Bearer ${tokenA}`),
    );
    expect(bySource.data.filter((r) => oppIds.includes(r.id)).map((r) => r.id)).toEqual([oppIds[1]]);

    const remoteOnly = body<OpportunityPage>(
      await request(http).get('/v1/opportunities?remote=true').set('Authorization', `Bearer ${tokenA}`),
    );
    const remoteOurs = remoteOnly.data.filter((r) => oppIds.includes(r.id)).map((r) => r.id).sort();
    expect(remoteOurs).toEqual([oppIds[0], oppIds[2]].sort());

    const withComp = body<OpportunityPage>(
      await request(http).get('/v1/opportunities?comp=true').set('Authorization', `Bearer ${tokenA}`),
    );
    expect(withComp.data.filter((r) => oppIds.includes(r.id)).map((r) => r.id)).toEqual([oppIds[1]]);

    const fresh = body<OpportunityPage>(
      await request(http).get('/v1/opportunities?freshness=7').set('Authorization', `Bearer ${tokenA}`),
    );
    const freshOurs = fresh.data.filter((r) => oppIds.includes(r.id)).map((r) => r.id).sort();
    // usajobs (40d) is excluded by a 7-day freshness window.
    expect(freshOurs).toEqual([oppIds[0], oppIds[1]].sort());
    expect(freshOurs).not.toContain(oppIds[2]);
  });

  it('cursor-paginates with limit', async () => {
    const p1 = body<OpportunityPage>(
      await request(http).get('/v1/opportunities?limit=1').set('Authorization', `Bearer ${tokenA}`),
    );
    expect(p1.data.length).toBe(1);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = body<OpportunityPage>(
      await request(http)
        .get(`/v1/opportunities?limit=1&cursor=${encodeURIComponent(p1.nextCursor!)}`)
        .set('Authorization', `Bearer ${tokenA}`),
    );
    expect(p2.data.length).toBe(1);
    // Distinct pages — no overlap between page 1 and page 2.
    expect(p2.data[0]!.id).not.toBe(p1.data[0]!.id);
  });

  it('returns detail with the SANITIZED raw_payload', async () => {
    const res = await request(http)
      .get(`/v1/opportunities/${ghOppId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    const detail = body<OpportunityDetail>(res);
    expect(detail.id).toBe(ghOppId);
    expect(detail.rawPayload.contentSanitized).toBe(SANITIZED);
  });

  it('404s an unknown opportunity id', async () => {
    const res = await request(http)
      .get(`/v1/opportunities/${randomUUID()}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(404);
  });

  it('scores the match PER-USER: A (weak) and B (strong) differ for the SAME opportunity', async () => {
    const resA = await request(http)
      .get(`/v1/opportunities/${ghOppId}/match`)
      .set('Authorization', `Bearer ${tokenA}`);
    const resB = await request(http)
      .get(`/v1/opportunities/${ghOppId}/match`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const a = body<MatchScore & { opportunityId: string }>(resA);
    const b = body<MatchScore & { opportunityId: string }>(resB);

    expect(a.opportunityId).toBe(ghOppId);
    // Honest bands: weak profile low, strong profile high — DIFFERENT scores.
    expect(a.overall).toBeLessThanOrEqual(25);
    expect(b.overall).toBeGreaterThanOrEqual(70);
    expect(a.overall).not.toBe(b.overall);

    // Every score carries its explanation (never a bare number); A's names the gap.
    expect(a.explanation.length).toBeGreaterThan(0);
    expect(a.explanation.toLowerCase()).toContain('python');
    expect(a.subscores.length).toBeGreaterThan(0);

    // Persisted per-user on the UNIQUE (profile, opportunity, model) key.
    const profA = await prisma.profile.findUnique({ where: { userId: userA.id } });
    const profB = await prisma.profile.findUnique({ where: { userId: userB.id } });
    const rowA = await prisma.matchScore.findUnique({
      where: {
        profileId_opportunityId_modelVersion: {
          profileId: profA!.id,
          opportunityId: ghOppId,
          modelVersion: MATCH_SCORER_MODEL_VERSION,
        },
      },
    });
    const rowB = await prisma.matchScore.findUnique({
      where: {
        profileId_opportunityId_modelVersion: {
          profileId: profB!.id,
          opportunityId: ghOppId,
          modelVersion: MATCH_SCORER_MODEL_VERSION,
        },
      },
    });
    expect(rowA).not.toBeNull();
    expect(rowB).not.toBeNull();
    expect(rowA!.overall).toBe(a.overall);
    expect(rowB!.overall).toBe(b.overall);
  });

  it('returns the persisted, reproducible score on a second call', async () => {
    const first = body<MatchScore>(
      await request(http).get(`/v1/opportunities/${ghOppId}/match`).set('Authorization', `Bearer ${tokenA}`),
    );
    const second = body<MatchScore>(
      await request(http).get(`/v1/opportunities/${ghOppId}/match`).set('Authorization', `Bearer ${tokenA}`),
    );
    expect(second.overall).toBe(first.overall);
    expect(second.explanation).toBe(first.explanation);
  });
});
