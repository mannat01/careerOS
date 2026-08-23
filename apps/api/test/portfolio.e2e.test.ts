import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { App } from 'supertest/types.js';
import { createAuditClient, InMemoryAuditSink } from '@careeros/observability';
import { hashPayload, InMemoryApprovalTokenStore } from '@careeros/capability-gate';
import {
  apiErrorSchema,
  portfolioGenerateResponseSchema,
  portfolioPublishResponseSchema,
  portfolioPublishTokenResponseSchema,
  publicPortfolioResponseSchema,
} from '@careeros/contracts';
import { PortfolioService } from '@careeros/cie-portfolio';
import { PortfolioController, PublicPortfolioController } from '../src/app/portfolio.controller.js';
import { BearerAuthGuard } from '../src/app/bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from '../src/app/deps.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import { InMemoryPortfolioStore } from '../src/modules/cie/portfolio.handlers.js';

const AUTH_SECRET = 'portfolio-http-auth-secret-at-least-32-characters';
const APPROVAL_SECRET = 'portfolio-http-token-secret-at-least-32-characters';

@Module({})
class TestPortfolioModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return {
      module: TestPortfolioModule,
      controllers: [PortfolioController, PublicPortfolioController],
      providers: [{ provide: APP_DEPS, useValue: deps }, BearerAuthGuard],
    };
  }
}

describe('FM6.6-pre portfolio HTTP boundary', () => {
  let app: INestApplication;
  let http: App;
  let tokenA: string;
  let tokenB: string;
  let version: { value: number };

  beforeAll(async () => {
    const tokenStore = new InMemoryApprovalTokenStore();
    const gate = {
      secret: APPROVAL_SECRET,
      tokenStore,
      audit: createAuditClient({ sink: new InMemoryAuditSink() }),
    };
    version = { value: 1 };
    const portfolio = {
      service: new PortfolioService({
        profile: {
          readProfileHeader: () => Promise.resolve({}),
          readProfileFacts: () => Promise.resolve([{
            id: 'skill:ts',
            kind: 'skill',
            summary: `TypeScript v${version.value}`,
          }]),
        },
        projects: { readProjects: () => Promise.resolve([]) },
        graph: { readGraphEvidence: () => Promise.resolve([]) },
        evidence: { readAllowedFactRefs: () => Promise.resolve(['skill:ts']) },
      }),
      store: new InMemoryPortfolioStore(),
    };
    const deps = {
      authProvider: new DevAuthProvider(AUTH_SECRET),
      portfolio,
      gate,
      userAutonomy: () => Promise.resolve('yellow' as const),
    } as unknown as AppDeps;
    app = await NestFactory.create(TestPortfolioModule.forRoot(deps), { logger: ['warn', 'error'] });
    await app.init();
    http = app.getHttpServer() as App;
    tokenA = await DevAuthProvider.mint(randomUUID(), AUTH_SECRET);
    tokenB = await DevAuthProvider.mint(randomUUID(), AUTH_SECRET);
  });

  beforeEach(() => {
    version.value = 1;
    const deps = app.get<AppDeps>(APP_DEPS);
    deps.portfolio.store = new InMemoryPortfolioStore();
    deps.gate.tokenStore = new InMemoryApprovalTokenStore();
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string): { Authorization: string } => ({ Authorization: `Bearer ${token}` });

  it('requires auth for owner/mint/publish while public read remains unauthenticated', async () => {
    expect((await request(http).get('/v1/portfolio')).status).toBe(401);
    expect((await request(http).post('/v1/portfolio/publish/mint').send({})).status).toBe(401);
    expect((await request(http).post('/v1/portfolio/publish').send({})).status).toBe(401);
    const publicMissing = await request(http).get('/v1/portfolio/public/unknown');
    expect(publicMissing.status).toBe(404);
    expect(apiErrorSchema.parse(publicMissing.body).error.code).toBe('not_found');
  });

  it('generate → private public 404 → mint without token → token-bound publish → public snapshot', async () => {
    const generatedResponse = await request(http).post('/v1/portfolio').set(auth(tokenA)).send({});
    expect(generatedResponse.status).toBe(200);
    const generated = portfolioGenerateResponseSchema.parse(generatedResponse.body);
    expect(generated.publishStatus).toBe('private');

    expect((await request(http).get(`/v1/portfolio/public/${generated.slug}`)).status).toBe(404);

    const withoutToken = await request(http).post('/v1/portfolio/publish').set(auth(tokenA)).send({});
    expect(withoutToken.status).toBe(403);
    expect((await request(http).get(`/v1/portfolio/public/${generated.slug}`)).status).toBe(404);

    const grantResponse = await request(http).post('/v1/portfolio/publish/mint').set(auth(tokenA)).send({});
    expect(grantResponse.status).toBe(200);
    const grant = portfolioPublishTokenResponseSchema.parse(grantResponse.body);
    expect(grant.content).toEqual(generated.content);
    expect(grant.payloadHash).toBe(hashPayload(grant.content));

    await request(http).post('/v1/portfolio').set(auth(tokenB)).send({});
    const crossUser = await request(http).post('/v1/portfolio/publish').set(auth(tokenB))
      .set('X-Approval-Token', grant.token).send({});
    expect(crossUser.status).toBe(403);
    expect(apiErrorSchema.parse(crossUser.body).error.details?.['reason']).toBe('approval_wrong_user');

    const publishedResponse = await request(http).post('/v1/portfolio/publish').set(auth(tokenA))
      .set('X-Approval-Token', grant.token).send({});
    expect(publishedResponse.status).toBe(200);
    const published = portfolioPublishResponseSchema.parse(publishedResponse.body);
    expect(published.content).toEqual(grant.content);

    const replay = await request(http).post('/v1/portfolio/publish').set(auth(tokenA))
      .set('X-Approval-Token', grant.token).send({});
    expect(replay.status).toBe(403);

    const publicResponse = await request(http).get(`/v1/portfolio/public/${generated.slug}`);
    expect(publicResponse.status).toBe(200);
    const publicView = publicPortfolioResponseSchema.parse(publicResponse.body);
    expect(publicView.content).toEqual(grant.content);
    expect(publicView).not.toHaveProperty('publishStatus');
    expect(publicView).not.toHaveProperty('hasPublishedSnapshot');
  });

  it('stale-after-regeneration is refused; fresh confirmation freezes a non-leaking snapshot', async () => {
    const first = portfolioGenerateResponseSchema.parse((
      await request(http).post('/v1/portfolio').set(auth(tokenA)).send({})
    ).body);
    const staleGrant = portfolioPublishTokenResponseSchema.parse((
      await request(http).post('/v1/portfolio/publish/mint').set(auth(tokenA)).send({})
    ).body);

    version.value = 2;
    const changed = portfolioGenerateResponseSchema.parse((
      await request(http).post('/v1/portfolio').set(auth(tokenA)).send({})
    ).body);
    expect(changed.content).not.toEqual(staleGrant.content);
    const stale = await request(http).post('/v1/portfolio/publish').set(auth(tokenA))
      .set('X-Approval-Token', staleGrant.token).send({});
    expect(stale.status).toBe(403);
    expect(apiErrorSchema.parse(stale.body).error.details?.['reason']).toBe('approval_payload_mismatch');
    expect((await request(http).get(`/v1/portfolio/public/${first.slug}`)).status).toBe(404);

    const freshGrant = portfolioPublishTokenResponseSchema.parse((
      await request(http).post('/v1/portfolio/publish/mint').set(auth(tokenA)).send({})
    ).body);
    const published = await request(http).post('/v1/portfolio/publish').set(auth(tokenA))
      .set('X-Approval-Token', freshGrant.token).send({});
    expect(published.status).toBe(200);

    version.value = 3;
    const laterDraft = portfolioGenerateResponseSchema.parse((
      await request(http).post('/v1/portfolio').set(auth(tokenA)).send({})
    ).body);
    const publicView = publicPortfolioResponseSchema.parse((
      await request(http).get(`/v1/portfolio/public/${first.slug}`)
    ).body);
    expect(publicView.content).toEqual(freshGrant.content);
    expect(publicView.content).not.toEqual(laterDraft.content);
  });
});