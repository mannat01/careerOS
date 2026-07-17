/**
 * e2e — /v1/briefings over the booted NestJS app.
 *
 * Sidesteps the env-heavy composition root: stands the Nest boundary up with a
 * tiny test module wiring ONLY the BriefingController + BearerAuthGuard, and
 * hand-crafted in-memory ports that honor the same shapes the Prisma stores +
 * concrete services implement. No Postgres/Redis/LLMs required.
 *
 * Proves at the HTTP boundary:
 *   - a manual briefing completes and composes at LEAST an opportunity + gap +
 *     focus item; steps/cost/traceId + audit are recorded;
 *   - an INJECTED step failure yields a PARTIAL briefing (not blank) with the
 *     failing step flagged + retryable;
 *   - per-user scoping: user A cannot read user B's briefing;
 *   - GET /latest returns the user's most recent run.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { DynamicModule, INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { createAuditClient, InMemoryAuditSink } from '@careeros/observability';
import type { MatchScore } from '@careeros/cie-resume';
import type { CareerStateModel } from '@careeros/cie-state';
import type { DecisionContract } from '@careeros/cie-reasoning';
import { BriefingController } from '../src/app/briefing.controller.js';
import { BearerAuthGuard } from '../src/app/bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from '../src/app/deps.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import type {
  BriefingHandlerDeps,
  BriefingItem,
  BriefingRun,
  BriefingRunDetail,
  BriefingRunStatus,
  BriefingStepRecord,
  BriefingStorePort,
  OpportunityDetail,
  OpportunityFilters,
  OpportunityPage,
  OpportunityReadPort,
  ProfileResolver,
} from '../src/index.js';

const DEV_SECRET = 'e2e-dev-auth-secret-that-is-at-least-32-chars';

@Module({})
class TestBriefingModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return {
      module: TestBriefingModule,
      controllers: [BriefingController],
      providers: [{ provide: APP_DEPS, useValue: deps }, BearerAuthGuard],
    };
  }
}

// ---------------- in-memory ports (mirror Prisma stores' contract) ----------------

class MemStore implements BriefingStorePort {
  runs = new Map<string, BriefingRun>();
  items = new Map<string, BriefingItem[]>();
  private seq = 0;

  createRun(input: {
    userId: string;
    trigger: 'scheduled' | 'manual';
    inputs: Record<string, unknown>;
  }): Promise<BriefingRun> {
    const id = `run-${++this.seq}`;
    const now = new Date().toISOString();
    const run: BriefingRun = {
      id,
      userId: input.userId,
      trigger: input.trigger,
      status: 'running',
      inputs: input.inputs,
      steps: [],
      costTotal: 0,
      startedAt: now,
      finishedAt: null,
    };
    this.runs.set(id, run);
    this.items.set(id, []);
    return Promise.resolve(run);
  }
  finalizeRun(
    runId: string,
    input: {
      status: BriefingRunStatus;
      steps: BriefingStepRecord[];
      costTotal: number;
      finishedAt: string;
    },
  ): Promise<BriefingRun> {
    const cur = this.runs.get(runId)!;
    const next = { ...cur, ...input };
    this.runs.set(runId, next);
    return Promise.resolve(next);
  }
  addItems(
    runId: string,
    items: Omit<BriefingItem, 'id' | 'createdAt'>[],
  ): Promise<BriefingItem[]> {
    const cur = this.items.get(runId) ?? [];
    const now = new Date().toISOString();
    const withIds = items.map((i, idx): BriefingItem => ({
      ...i,
      id: `${runId}-item-${cur.length + idx + 1}`,
      createdAt: now,
    }));
    this.items.set(runId, [...cur, ...withIds]);
    return Promise.resolve(withIds);
  }
  getById(userId: string, id: string): Promise<BriefingRunDetail | null> {
    const run = this.runs.get(id);
    if (!run || run.userId !== userId) return Promise.resolve(null);
    return Promise.resolve({ ...run, items: this.items.get(id) ?? [] });
  }
  latestForUser(userId: string): Promise<BriefingRunDetail | null> {
    const owned = [...this.runs.values()].filter((r) => r.userId === userId);
    if (owned.length === 0) return Promise.resolve(null);
    owned.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    const latest = owned[0]!;
    return Promise.resolve({ ...latest, items: this.items.get(latest.id) ?? [] });
  }
}

const OPP: OpportunityDetail = {
  id: 'opp-e2e-1',
  source: 'greenhouse',
  sourceRef: 'gh-e2e-1',
  company: 'Acme',
  role: 'Senior Backend Engineer',
  location: 'Remote',
  remote: true,
  comp: { min: 180000, max: 220000, currency: 'USD' },
  requirementsParsed: null,
  rawPayload: { sanitized: 'ok' },
  ingestedAt: new Date().toISOString(),
};

class FakeReadStore implements OpportunityReadPort {
  list(_f: OpportunityFilters, _p: { limit: number }): Promise<OpportunityPage> {
    const { rawPayload: _p2, requirementsParsed: _r, ...listItem } = OPP;
    return Promise.resolve({
      data: [listItem],
      nextCursor: null,
    } as OpportunityPage);
  }
  getById(id: string): Promise<OpportunityDetail | null> {
    return Promise.resolve(id === OPP.id ? OPP : null);
  }
}

const profiles: ProfileResolver = {
  resolveProfileId: (userId: string) => Promise.resolve(`profile-${userId}`),
};

const makeScore = (): MatchScore => ({
  overall: 78,
  subscores: [
    { key: 'skills', value: 40 },
    { key: 'seniority', value: 80 },
  ],
  explanation: 'Grounded — TS strong, python weak.',
  evidenceRefs: ['exp-1'],
  modelVersion: 'match-scorer@1.0.0',
});
const scorer = {
  scoreJob: () => Promise.resolve(makeScore()),
} as unknown as BriefingHandlerDeps['scorer'];

const contract: DecisionContract = {
  recommendation: 'apply',
  alternatives: ['wait', 'negotiate'],
  evidenceRefs: ['exp-1'],
  reasoning: 'Grounded reasoning.',
  confidence: 0.7,
  assumptions: [],
  modelVersion: 'strategic-reasoner@1.0.0',
};
const reasoner = {
  decide: () => Promise.resolve(contract),
} as unknown as BriefingHandlerDeps['reasoner'];

const stateModel: CareerStateModel = {
  profileId: 'profile-x',
  version: 1,
  updatedAt: new Date().toISOString(),
  dimensions: [
    {
      dimension: 'compensation_goals',
      value: { values: [] },
      confidence: 0.2,
      provenance: 'inferred',
      evidenceRefs: [],
      freshnessAt: new Date().toISOString(),
      modelVersion: 'state-updater@1.0.0',
    },
  ],
};
const state = {
  getState: () => Promise.resolve(stateModel),
} as unknown as BriefingHandlerDeps['state'];

// ---------------- e2e ----------------

describe('M05 /v1/briefings over HTTP', () => {
  let app: INestApplication;
  let http: App;
  let store: MemStore;
  let auditSink: InMemoryAuditSink;
  let injectedGapFailure = false;
  const userA = randomUUID();
  const userB = randomUUID();
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    store = new MemStore();
    auditSink = new InMemoryAuditSink();
    const audit = createAuditClient({ sink: auditSink });

    const briefing: BriefingHandlerDeps = {
      store,
      opportunities: new FakeReadStore(),
      profiles,
      scorer,
      reasoner,
      state,
      audit,
      topN: 3,
    };
    // A dynamic override — the test flips `injectedGapFailure` at runtime,
    // and the getter re-reads the flag on each run to inject/withdraw the
    // failing gap step. This proves partial-on-failure over HTTP.
    Object.defineProperty(briefing, 'overrides', {
      get() {
        return injectedGapFailure
          ? { gaps: () => Promise.reject(new Error('injected e2e gap failure')) }
          : undefined;
      },
    });

    const deps = {
      authProvider: new DevAuthProvider(DEV_SECRET),
      briefing,
    } as unknown as AppDeps;

    app = await NestFactory.create(TestBriefingModule.forRoot(deps), {
      logger: ['warn', 'error'],
    });
    await app.init();
    http = app.getHttpServer() as App;

    tokenA = await DevAuthProvider.mint(userA, DEV_SECRET);
    tokenB = await DevAuthProvider.mint(userB, DEV_SECRET);
  });

  afterAll(async () => {
    await app.close();
  });

  it('missing bearer token → 401', async () => {
    const res = await request(http).post('/v1/briefings/run').send({ trigger: 'manual' });
    expect(res.status).toBe(401);
  });

  it('POST /run composes opportunity + gap + focus items; records steps/cost/audit', async () => {
    const res = await request(http)
      .post('/v1/briefings/run')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ trigger: 'manual' });

    expect(res.status).toBe(201);
    const body = res.body as BriefingRunDetail;
    expect(body.status).toBe('complete');
    expect(body.steps.map((s) => s.name)).toEqual(['scored_opportunities', 'gaps', 'focus']);
    expect(body.costTotal).toBeGreaterThan(0);
    const kinds = body.items.map((i) => i.kind);
    expect(kinds).toContain('opportunity');
    expect(kinds).toContain('gap');
    expect(kinds).toContain('focus');
    for (const i of body.items) {
      expect(i.state).toBe('proposed');
      expect(i.autonomyTier).toBe('green');
    }
    // Audit persisted for the user.
    expect(
      auditSink.records().some((r) => r.action === 'briefing.run.manual' && r.userId === userA),
    ).toBe(true);
  });

  it('an injected step failure yields a PARTIAL briefing (never blank)', async () => {
    injectedGapFailure = true;
    try {
      const res = await request(http)
        .post('/v1/briefings/run')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ trigger: 'manual' });

      expect(res.status).toBe(201);
      const body = res.body as BriefingRunDetail;
      expect(body.status).toBe('partial');
      const gapStep = body.steps.find((s) => s.name === 'gaps')!;
      expect(gapStep.status).toBe('failed');
      expect(gapStep.retryable).toBe(true);
      // Never blank — opp + focus items still composed.
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.some((i) => i.kind === 'opportunity')).toBe(true);
      expect(body.items.some((i) => i.kind === 'focus')).toBe(true);
    } finally {
      injectedGapFailure = false;
    }
  });

  it('GET /latest returns the most recent run for the caller', async () => {
    const res = await request(http)
      .get('/v1/briefings/latest')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    const body = res.body as BriefingRunDetail;
    expect(body.userId).toBe(userA);
    expect(body.items).toBeInstanceOf(Array);
  });

  it('per-user scoping: user B cannot read user A\'s run (404)', async () => {
    // Create a run for user A, then read it as user B.
    const created = await request(http)
      .post('/v1/briefings/run')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ trigger: 'manual' });
    const id = (created.body as BriefingRunDetail).id;

    const cross = await request(http)
      .get(`/v1/briefings/${id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(cross.status).toBe(404);

    const own = await request(http)
      .get(`/v1/briefings/${id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(own.status).toBe(200);
  });
});