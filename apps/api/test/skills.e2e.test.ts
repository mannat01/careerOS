import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { App } from 'supertest/types.js';
import { skillGapsResponseSchema } from '@careeros/contracts';
import type { GapAnalysis } from '@careeros/cie-skills';
import type {
  LearningItemRowLike,
  SkillGapRowLike,
  SkillGapStorePortShape,
  SkillGapWriteLike,
} from '@careeros/db';
import { SkillsController } from '../src/app/skills.controller.js';
import { BearerAuthGuard } from '../src/app/bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from '../src/app/deps.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import type { SkillsHandlerDeps } from '../src/modules/cie/skills.handlers.js';

const AUTH_SECRET = 'skills-e2e-auth-secret-that-is-at-least-32-chars';
const OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000061';

@Module({})
class TestSkillsModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return {
      module: TestSkillsModule,
      controllers: [SkillsController],
      providers: [{ provide: APP_DEPS, useValue: deps }, BearerAuthGuard],
    };
  }
}

class FixtureSkillGapStore implements SkillGapStorePortShape {
  replaceForProfile(_profileId: string, gaps: SkillGapWriteLike[]): Promise<SkillGapRowLike[]> {
    return Promise.resolve(gaps.map((gap, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      skill: gap.skill,
      gap: gap.gap,
      severity: gap.severity,
      source: gap.source,
      opportunityId: gap.opportunityId ?? null,
      evidenceRefs: gap.evidenceRefs,
      modelVersion: gap.modelVersion,
      computedAt: '2026-08-20T12:00:00.000Z',
    })));
  }

  listGaps(): Promise<SkillGapRowLike[]> {
    return Promise.resolve([]);
  }

  listLearningItems(): Promise<LearningItemRowLike[]> {
    return Promise.resolve([]);
  }

  updateLearningItem(): Promise<LearningItemRowLike | null> {
    return Promise.resolve(null);
  }
}

describe('FM6.4-pre GET /v1/skills/gaps public contract', () => {
  let app: INestApplication;
  let http: App;
  const owner = randomUUID();
  const otherUser = randomUUID();
  const thinUser = randomUUID();
  let ownerToken: string;
  let otherToken: string;
  let thinToken: string;

  beforeAll(async () => {
    const analysisByUser = new Map<string, GapAnalysis>([
      [owner, {
        status: 'ok',
        modelVersion: 'gap-analyzer@1.0.0',
        analyzedOpportunityIds: [OPPORTUNITY_ID],
        gaps: [
          {
            key: `per_opp:kubernetes:${OPPORTUNITY_ID}`,
            skill: 'kubernetes',
            gap: 'Kubernetes is required by Nimbus — Platform Engineer but is not demonstrated.',
            severity: 'high',
            source: 'per_opp',
            opportunityId: OPPORTUNITY_ID,
            evidenceRefs: ['subscore:skills=31', 'requirement:kubernetes'],
          },
          {
            key: 'aggregate:leadership_readiness',
            skill: 'leadership_readiness',
            gap: 'Your leadership-readiness signal is weak relative to your stated target role.',
            severity: 'medium',
            source: 'aggregate',
            evidenceRefs: ['dimension:leadership_readiness@0.2', 'target_role:Engineering Manager'],
          },
        ],
        learningItems: [],
      }],
      [thinUser, {
        status: 'insufficient_data',
        modelVersion: 'gap-analyzer@1.0.0',
        analyzedOpportunityIds: [],
        gaps: [],
        learningItems: [],
      }],
    ]);
    const skills: SkillsHandlerDeps = {
      store: new FixtureSkillGapStore(),
      profileResolver: {
        resolveProfileId: (userId) => Promise.resolve(`profile-${userId}`),
      },
      opportunities: {
        isStoredByUser: (userId, opportunityId) => Promise.resolve(
          opportunityId === OPPORTUNITY_ID && (userId === owner || userId === thinUser),
        ),
      },
      analyzer: {
        analyze: (userId) => Promise.resolve(analysisByUser.get(userId) ?? {
          status: 'insufficient_data',
          modelVersion: 'gap-analyzer@1.0.0',
          analyzedOpportunityIds: [],
          gaps: [],
          learningItems: [],
        }),
      },
    };
    const deps = {
      authProvider: new DevAuthProvider(AUTH_SECRET),
      skills,
    } as unknown as AppDeps;

    app = await NestFactory.create(TestSkillsModule.forRoot(deps), { logger: ['warn', 'error'] });
    await app.init();
    http = app.getHttpServer() as App;
    [ownerToken, otherToken, thinToken] = await Promise.all([
      DevAuthProvider.mint(owner, AUTH_SECRET),
      DevAuthProvider.mint(otherUser, AUTH_SECRET),
      DevAuthProvider.mint(thinUser, AUTH_SECRET),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the full contract-valid aggregate and per-opportunity gap set', async () => {
    const response = await request(http)
      .get('/v1/skills/gaps')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    const body = skillGapsResponseSchema.parse(response.body);
    expect(body.status).toBe('ok');
    if (body.status !== 'ok') throw new Error('Expected analyzed gaps.');
    expect(body.gaps).toHaveLength(2);
    expect(response.body).not.toHaveProperty('confidence');
  });

  it('returns the discriminated insufficient_data variant for a thin profile', async () => {
    const response = await request(http)
      .get('/v1/skills/gaps')
      .set('Authorization', `Bearer ${thinToken}`);

    expect(response.status).toBe(200);
    expect(skillGapsResponseSchema.parse(response.body)).toEqual({ status: 'insufficient_data' });
  });

  it('scopes an owned opportunity to its per-opportunity gaps', async () => {
    const response = await request(http)
      .get(`/v1/skills/gaps?opportunityId=${OPPORTUNITY_ID}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    const body = skillGapsResponseSchema.parse(response.body);
    expect(body.status).toBe('ok');
    if (body.status !== 'ok') throw new Error('Expected analyzed gaps.');
    expect(body.gaps).toHaveLength(1);
    expect(body.gaps[0]).toMatchObject({ source: 'per_opp', opportunityId: OPPORTUNITY_ID });
  });

  it('denies an opportunity outside the caller pipeline', async () => {
    const response = await request(http)
      .get(`/v1/skills/gaps?opportunityId=${OPPORTUNITY_ID}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: {
        code: 'capability_denied',
        details: { opportunityId: OPPORTUNITY_ID, reason: 'opportunity_not_owned' },
      },
    });
  });
});