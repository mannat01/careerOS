import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { App } from 'supertest/types.js';
import {
  DraftingService,
  groundDraft,
  type Draft,
  type DrafterAgent,
  type DraftInput,
  type ProfileFact,
} from '@careeros/cie-drafting';
import { draftResponseSchema } from '@careeros/contracts';
import { DraftsController } from '../src/app/drafts.controller.js';
import { BearerAuthGuard } from '../src/app/bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from '../src/app/deps.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import {
  InMemoryDraftStore,
  StaticChannelPolicy,
  type DraftsHandlerDeps,
} from '../src/modules/cie/drafts.handlers.js';

const AUTH_SECRET = 'drafts-e2e-auth-secret-that-is-at-least-32-chars';
const OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000063';
const UNKNOWN_OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000099';
const JOB = {
  title: 'Staff Engineer',
  company: 'Nimbus',
  requirements: ['TypeScript services'],
  text: 'Build reliable TypeScript services at Nimbus.',
};

@Module({})
class TestDraftsModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return {
      module: TestDraftsModule,
      controllers: [DraftsController],
      providers: [{ provide: APP_DEPS, useValue: deps }, BearerAuthGuard],
    };
  }
}

class GuardedFixtureAgent implements DrafterAgent {
  draft(input: DraftInput): Promise<Draft> {
    return Promise.resolve(groundDraft(input, { subject: '', body: '', claims: [] }).draft);
  }
}

describe('FM6.3-pre POST /v1/drafts', () => {
  let app: INestApplication;
  let http: App;
  const owner = randomUUID();
  const otherUser = randomUUID();
  const thinUser = randomUUID();
  const profiles = new Map<string, ProfileFact[]>([
    [owner, [{ id: 'experience:typescript', kind: 'experience', summary: 'Built reliable TypeScript services.' }]],
    [otherUser, [{ id: 'experience:python', kind: 'experience', summary: 'Built Python data tools.' }]],
    [thinUser, []],
  ]);
  const pipeline = new Map<string, Set<string>>([
    [owner, new Set([OPPORTUNITY_ID])],
    [thinUser, new Set([OPPORTUNITY_ID])],
  ]);
  let ownerToken: string;
  let otherToken: string;
  let thinToken: string;

  beforeAll(async () => {
    const service = new DraftingService({
      profile: { readProfileFacts: (userId) => Promise.resolve(profiles.get(userId) ?? []) },
      state: { readStateDimensions: () => Promise.resolve([]) },
      graph: { readGraph: () => Promise.resolve([]) },
      opportunity: {
        readOpportunity: (_userId, opportunityId) => {
          if (opportunityId !== OPPORTUNITY_ID) return Promise.reject(new Error('unknown opportunity'));
          return Promise.resolve(JOB);
        },
      },
      evidence: {
        readAllowedFactRefs: (userId) =>
          Promise.resolve((profiles.get(userId) ?? []).map((fact) => fact.id)),
      },
      agent: new GuardedFixtureAgent(),
    });
    const drafts: DraftsHandlerDeps = {
      service,
      opportunities: {
        exists: (opportunityId) => Promise.resolve(opportunityId === OPPORTUNITY_ID),
        isStoredByUser: (userId, opportunityId) =>
          Promise.resolve(pipeline.get(userId)?.has(opportunityId) ?? false),
      },
      store: new InMemoryDraftStore(),
      channels: new StaticChannelPolicy(),
      sender: { send: () => Promise.resolve() },
      now: () => new Date('2026-08-18T12:00:00.000Z'),
    };
    const deps = {
      authProvider: new DevAuthProvider(AUTH_SECRET),
      drafts,
    } as unknown as AppDeps;

    app = await NestFactory.create(TestDraftsModule.forRoot(deps), { logger: ['warn', 'error'] });
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

  it('returns a contract-valid grounded draft that remains unsent', async () => {
    const response = await request(http)
      .post('/v1/drafts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ kind: 'cover_letter', opportunityId: OPPORTUNITY_ID });

    expect(response.status).toBe(200);
    const body = draftResponseSchema.parse(response.body);
    expect(body.status).toBe('draft');
    if (body.status !== 'draft') throw new Error('Expected a grounded draft.');
    expect(body.claims).toEqual([
      { claim: 'For "TypeScript services": Built reliable TypeScript services.', factRef: 'experience:typescript' },
    ]);
    expect(body.sentAt).toBeNull();
  });

  it('returns only insufficient_data when no grounded claim survives', async () => {
    const response = await request(http)
      .post('/v1/drafts')
      .set('Authorization', `Bearer ${thinToken}`)
      .send({ kind: 'outreach', opportunityId: OPPORTUNITY_ID });

    expect(response.status).toBe(200);
    expect(draftResponseSchema.parse(response.body)).toEqual({ status: 'insufficient_data' });
    expect(response.body).not.toHaveProperty('subject');
    expect(response.body).not.toHaveProperty('body');
    expect(response.body).not.toHaveProperty('claims');
  });

  it('denies an existing opportunity outside the caller pipeline', async () => {
    const response = await request(http)
      .post('/v1/drafts')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ kind: 'cover_letter', opportunityId: OPPORTUNITY_ID });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: {
        code: 'capability_denied',
        details: { opportunityId: OPPORTUNITY_ID, reason: 'opportunity_not_owned' },
      },
    });
  });

  it('returns 404 for an unknown opportunity before ownership evaluation', async () => {
    const response = await request(http)
      .post('/v1/drafts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ kind: 'cover_letter', opportunityId: UNKNOWN_OPPORTUNITY_ID });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: { code: 'not_found', details: { opportunityId: UNKNOWN_OPPORTUNITY_ID } },
    });
  });
});