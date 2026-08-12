/** FM5.1-pre adversarial guarantee suite over the real Nest HTTP boundary. */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { App } from 'supertest/types.js';
import { createAuditClient, InMemoryAuditSink } from '@careeros/observability';
import { InMemoryApprovalTokenStore } from '@careeros/capability-gate';
import {
  approvalDenyResponseSchema,
  approvalEditResponseSchema,
  approvalExecuteResponseSchema,
  approvalMintResponseSchema,
  apiErrorSchema,
  pendingApprovalListResponseSchema,
} from '@careeros/contracts';
import { ApprovalsController } from '../src/app/approvals.controller.js';
import { BearerAuthGuard } from '../src/app/bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from '../src/app/deps.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import type {
  ApprovalLifecycleHandlerDeps,
  BriefingItem,
  BriefingItemState,
  BriefingStorePort,
} from '../src/index.js';

const AUTH_SECRET = 'approval-http-auth-secret-at-least-32-characters';
const APPROVAL_SECRET = 'approval-http-token-secret-at-least-32-characters';

class ApprovalStore implements BriefingStorePort {
  private readonly records = new Map<string, { userId: string; item: BriefingItem }>();

  seed(userId: string, payload: Record<string, unknown> = { body: 'payload-a' }): BriefingItem {
    const id = randomUUID();
    const item: BriefingItem = {
      id,
      kind: 'draft',
      refId: 'draft-1',
      autonomyTier: 'yellow',
      state: 'proposed',
      payload,
      action: 'briefing.item.execute',
      why: 'The prepared action changes persisted state and requires explicit consent.',
      resourceRefs: [{ type: 'briefing_run', id: 'run-1' }, { type: 'draft', id: 'draft-1' }],
      createdAt: new Date('2026-08-12T10:00:00.000Z').toISOString(),
    };
    this.records.set(id, { userId, item });
    return item;
  }

  reset(): void {
    this.records.clear();
  }

  get(id: string): BriefingItem | null {
    return this.records.get(id)?.item ?? null;
  }

  listPendingApprovals(userId: string): Promise<BriefingItem[]> {
    return Promise.resolve(
      [...this.records.values()]
        .filter((record) => record.userId === userId)
        .map((record) => record.item)
        .filter((item) => item.state === 'proposed' || item.state === 'approved'),
    );
  }

  findApprovalForUser(userId: string, approvalId: string): Promise<BriefingItem | null> {
    const record = this.records.get(approvalId);
    return Promise.resolve(record?.userId === userId ? record.item : null);
  }

  updateItemState(
    itemId: string,
    input: { state: BriefingItemState; payload?: Record<string, unknown> },
  ): Promise<BriefingItem> {
    const record = this.records.get(itemId);
    if (!record) throw new Error(`Unknown approval ${itemId}`);
    const item = { ...record.item, state: input.state, payload: input.payload ?? record.item.payload };
    this.records.set(itemId, { ...record, item });
    return Promise.resolve(item);
  }

  findItemOnUserRun(userId: string, _runId: string, itemId: string): Promise<BriefingItem | null> {
    return this.findApprovalForUser(userId, itemId);
  }

  createRun(): never { throw new Error('unused'); }
  finalizeRun(): never { throw new Error('unused'); }
  addItems(): never { throw new Error('unused'); }
  getById(): never { throw new Error('unused'); }
  latestForUser(): never { throw new Error('unused'); }
}

@Module({})
class TestApprovalsModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return {
      module: TestApprovalsModule,
      controllers: [ApprovalsController],
      providers: [{ provide: APP_DEPS, useValue: deps }, BearerAuthGuard],
    };
  }
}

describe('FM5.1-pre /v1/approvals lifecycle guarantees', () => {
  let app: INestApplication;
  let http: App;
  let store: ApprovalStore;
  let tokenStore: InMemoryApprovalTokenStore;
  let tokenA: string;
  let tokenB: string;
  let userA: string;
  let userB: string;
  let clockMs: number;
  let executeCalls: Array<{ approvalId: string; payload: Record<string, unknown> }>;

  beforeAll(async () => {
    userA = randomUUID();
    userB = randomUUID();
    store = new ApprovalStore();
    tokenStore = new InMemoryApprovalTokenStore();
    const audit = createAuditClient({ sink: new InMemoryAuditSink() });
    const lifecycle: ApprovalLifecycleHandlerDeps = {
      store,
      tokenStore,
      audit,
      approvalSecret: APPROVAL_SECRET,
      approvalTtlMs: 1_000,
      clock: () => new Date(clockMs),
      executor: {
        execute: ({ approvalId, payload }) => {
          executeCalls.push({ approvalId, payload });
          return Promise.resolve({ outcome: 'briefing_item_executed' });
        },
      },
    };
    const deps = {
      authProvider: new DevAuthProvider(AUTH_SECRET),
      approvalLifecycle: lifecycle,
    } as unknown as AppDeps;
    app = await NestFactory.create(TestApprovalsModule.forRoot(deps), { logger: ['warn', 'error'] });
    await app.init();
    http = app.getHttpServer() as App;
    tokenA = await DevAuthProvider.mint(userA, AUTH_SECRET);
    tokenB = await DevAuthProvider.mint(userB, AUTH_SECRET);
  });

  beforeEach(() => {
    store.reset();
    tokenStore = new InMemoryApprovalTokenStore();
    const deps = app.get<AppDeps>(APP_DEPS).approvalLifecycle;
    deps.tokenStore = tokenStore;
    clockMs = Date.parse('2026-08-12T10:00:00.000Z');
    executeCalls = [];
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string): { Authorization: string } => ({ Authorization: `Bearer ${token}` });

  async function mint(item: BriefingItem, token = tokenA) {
    return request(http)
      .post(`/v1/approvals/${item.id}/mint`)
      .set(auth(token))
      .send({ approvalId: item.id, payload: item.payload });
  }

  it('happy path: list → mint → execute → executed item leaves pending list', async () => {
    const item = store.seed(userA);
    const listed = await request(http).get('/v1/approvals/pending').set(auth(tokenA));
    expect(listed.status).toBe(200);
    expect(pendingApprovalListResponseSchema.parse(listed.body).data[0]).toMatchObject({
      id: item.id,
      action: item.action,
      why: item.why,
      payload: item.payload,
    });

    const minted = await mint(item);
    expect(minted.status).toBe(200);
    const grant = approvalMintResponseSchema.parse(minted.body);
    const executed = await request(http)
      .post(`/v1/approvals/${item.id}/execute`)
      .set(auth(tokenA))
      .send({ token: grant.token, payload: item.payload });
    expect(executed.status).toBe(200);
    expect(approvalExecuteResponseSchema.parse(executed.body)).toMatchObject({
      approvalId: item.id,
      state: 'executed',
      outcome: 'briefing_item_executed',
    });
    expect(executeCalls).toHaveLength(1);
    expect(store.get(item.id)?.state).toBe('executed');

    const after = await request(http).get('/v1/approvals/pending').set(auth(tokenA));
    expect(pendingApprovalListResponseSchema.parse(after.body).data).toEqual([]);
  });

  it('replay: second execute fails token_consumed and produces no second side effect', async () => {
    const item = store.seed(userA);
    const grant = approvalMintResponseSchema.parse((await mint(item)).body);
    const first = await request(http).post(`/v1/approvals/${item.id}/execute`).set(auth(tokenA))
      .send({ token: grant.token, payload: item.payload });
    expect(first.status).toBe(200);
    const second = await request(http).post(`/v1/approvals/${item.id}/execute`).set(auth(tokenA))
      .send({ token: grant.token, payload: item.payload });
    expect(second.status).toBe(403);
    expect(apiErrorSchema.parse(second.body).error.details?.['reason']).toBe('token_consumed');
    expect(executeCalls).toHaveLength(1);
  });

  it('fresh mint supersedes the prior live token for the same approval', async () => {
    const item = store.seed(userA);
    const oldGrant = approvalMintResponseSchema.parse((await mint(item)).body);
    const freshGrant = approvalMintResponseSchema.parse((await mint(item)).body);

    const superseded = await request(http).post(`/v1/approvals/${item.id}/execute`).set(auth(tokenA))
      .send({ token: oldGrant.token, payload: item.payload });
    expect(superseded.status).toBe(403);
    expect(apiErrorSchema.parse(superseded.body).error.details?.['reason']).toBe('token_consumed');

    const current = await request(http).post(`/v1/approvals/${item.id}/execute`).set(auth(tokenA))
      .send({ token: freshGrant.token, payload: item.payload });
    expect(current.status).toBe(200);
    expect(executeCalls).toHaveLength(1);
  });

  it('expired: expired token fails and produces no side effect', async () => {
    const item = store.seed(userA);
    const grant = approvalMintResponseSchema.parse((await mint(item)).body);
    clockMs += 1_001;
    const executed = await request(http).post(`/v1/approvals/${item.id}/execute`).set(auth(tokenA))
      .send({ token: grant.token, payload: item.payload });
    expect(executed.status).toBe(403);
    expect(apiErrorSchema.parse(executed.body).error.details?.['reason']).toBe('token_expired');
    expect(executeCalls).toHaveLength(0);
  });

  it('payload mismatch: token for A cannot execute B and produces no side effect', async () => {
    const item = store.seed(userA, { body: 'payload-a' });
    const grant = approvalMintResponseSchema.parse((await mint(item)).body);
    const executed = await request(http).post(`/v1/approvals/${item.id}/execute`).set(auth(tokenA))
      .send({ token: grant.token, payload: { body: 'payload-b' } });
    expect(executed.status).toBe(403);
    expect(apiErrorSchema.parse(executed.body).error.details?.['reason']).toBe('payload_mismatch');
    expect(executeCalls).toHaveLength(0);
  });

  it('edit invalidates old payload grant; re-mint edited payload executes exactly once', async () => {
    const item = store.seed(userA, { body: 'payload-a' });
    const oldGrant = approvalMintResponseSchema.parse((await mint(item)).body);
    const edited = await request(http).post(`/v1/approvals/${item.id}/edit`).set(auth(tokenA))
      .send({ approvalId: item.id, payload: { body: 'payload-b' } });
    expect(edited.status).toBe(200);
    expect(approvalEditResponseSchema.parse(edited.body)).toMatchObject({ state: 'proposed' });

    const oldExecution = await request(http).post(`/v1/approvals/${item.id}/execute`).set(auth(tokenA))
      .send({ token: oldGrant.token, payload: { body: 'payload-b' } });
    expect(oldExecution.status).toBe(403);
    expect(apiErrorSchema.parse(oldExecution.body).error.details?.['reason']).toBe('payload_mismatch');
    expect(executeCalls).toHaveLength(0);

    const editedItem = store.get(item.id)!;
    const freshGrant = approvalMintResponseSchema.parse((await mint(editedItem)).body);
    const freshExecution = await request(http).post(`/v1/approvals/${item.id}/execute`).set(auth(tokenA))
      .send({ token: freshGrant.token, payload: editedItem.payload });
    expect(freshExecution.status).toBe(200);
    expect(executeCalls).toHaveLength(1);
  });

  it('cross-user: B cannot list, mint, edit, execute, or deny A approval', async () => {
    const item = store.seed(userA);
    const grant = approvalMintResponseSchema.parse((await mint(item)).body);
    const list = await request(http).get('/v1/approvals/pending').set(auth(tokenB));
    expect(pendingApprovalListResponseSchema.parse(list.body).data).toEqual([]);

    const attempts = await Promise.all([
      request(http).post(`/v1/approvals/${item.id}/mint`).set(auth(tokenB))
        .send({ approvalId: item.id, payload: item.payload }),
      request(http).post(`/v1/approvals/${item.id}/edit`).set(auth(tokenB))
        .send({ approvalId: item.id, payload: { body: 'b' } }),
      request(http).post(`/v1/approvals/${item.id}/execute`).set(auth(tokenB))
        .send({ token: grant.token, payload: item.payload }),
      request(http).post(`/v1/approvals/${item.id}/deny`).set(auth(tokenB))
        .send({ approvalId: item.id, reason: 'B cannot decide.' }),
    ]);
    expect(attempts.map((response) => response.status)).toEqual([404, 404, 404, 404]);
    expect(executeCalls).toHaveLength(0);
  });

  it('deny is terminal: cannot mint or execute after denial', async () => {
    const item = store.seed(userA);
    const grant = approvalMintResponseSchema.parse((await mint(item)).body);
    const denied = await request(http).post(`/v1/approvals/${item.id}/deny`).set(auth(tokenA))
      .send({ approvalId: item.id, reason: 'User declined this action.' });
    expect(denied.status).toBe(200);
    expect(approvalDenyResponseSchema.parse(denied.body).state).toBe('denied');

    const remint = await mint(store.get(item.id)!);
    expect(remint.status).toBe(409);
    const execute = await request(http).post(`/v1/approvals/${item.id}/execute`).set(auth(tokenA))
      .send({ token: grant.token, payload: item.payload });
    expect(execute.status).toBe(409);
    expect(executeCalls).toHaveLength(0);
  });
});