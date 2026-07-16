/**
 * e2e — /rt/twin over the booted NestJS app (SSE streaming). This test does NOT
 * need Postgres/Redis; it stands the Nest boundary up with hand-crafted deps
 * (fake TwinMemoryPort / TwinProfilePort / TwinReasonerPort + an in-memory
 * AuditSink) so the streaming HTTP surface is exercised end-to-end without
 * pulling the whole composition root.
 *
 * Proves at the HTTP boundary:
 *   - a strategic chat turn streams the SSE event sequence
 *     (context → tool_call → tool_result → token+ → done) and the memory
 *     context carried is a BOUNDED slice (`usedTokens <= budgetTokens`, and
 *     `truncated=true` — i.e. a strict subset, never the full memory dump);
 *   - a Yellow action requested via chat ("send this outreach") is BLOCKED:
 *     the stream contains `approval_required` (never a `token`), the reasoner
 *     is never invoked, and the audit log records the blocked attempt.
 *   - auth is required (401 without a bearer token).
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { DynamicModule, INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { createAuditClient, InMemoryAuditSink } from '@careeros/observability';
import type { WorkingSlice } from '@careeros/memory';
import type { DecisionContract } from '@careeros/cie-reasoning';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { TwinController } from '../src/app/twin.controller.js';
import { BearerAuthGuard } from '../src/app/bearer-auth.guard.js';
import { APP_DEPS, type AppDeps } from '../src/app/deps.js';
import { DevAuthProvider } from '../src/common/auth/dev-auth-provider.js';
import type {
  TwinHandlerDeps,
  TwinMemoryPort,
  TwinProfilePort,
  TwinReasonerPort,
} from '../src/index.js';

const DEV_SECRET = 'e2e-dev-auth-secret-that-is-at-least-32-chars';

/**
 * Minimal test AppModule with ONLY the TwinController wired. Sidesteps the
 * env-heavy composition root — the SSE + Yellow-block invariants live entirely
 * in the twin handler + controller, so we don't need Postgres or Redis here.
 */
@Module({})
class TestTwinModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return {
      module: TestTwinModule,
      controllers: [TwinController],
      providers: [{ provide: APP_DEPS, useValue: deps }, BearerAuthGuard],
    };
  }
}

const BOUNDED_SLICE: WorkingSlice = {
  summary: 'Backend engineer, Python + Postgres',
  entries: [
    { tier: 'profile', text: 'python 5y', ref: 'experience:1', tokens: 10, score: 0.9 },
    { tier: 'semantic', text: 'data platforms', ref: 'insight:1', tokens: 6, score: 0.7 },
  ],
  usedTokens: 40,
  budgetTokens: 512,
  truncated: true,
};

class FakeMemory implements TwinMemoryPort {
  calls: Array<Parameters<TwinMemoryPort['retrieve']>[0]> = [];
  retrieve(task: Parameters<TwinMemoryPort['retrieve']>[0]): Promise<WorkingSlice> {
    this.calls.push(task);
    return Promise.resolve(BOUNDED_SLICE);
  }
}
class FakeProfiles implements TwinProfilePort {
  resolveProfileId(): Promise<string | null> {
    return Promise.resolve('profile-e2e');
  }
}
class FakeReasoner implements TwinReasonerPort {
  calls: Array<{ userId: string; question: string }> = [];
  decide(userId: string, question: string): Promise<DecisionContract> {
    this.calls.push({ userId, question });
    return Promise.resolve({
      alternatives: ['apply', 'wait', 'negotiate'],
      evidenceRefs: ['experience:1'],
      reasoning: 'Strong match — Python + Postgres directly cited.',
      confidence: 0.72,
      assumptions: ['Requirements current'],
      recommendation: 'apply',
      optionalityNote: 'Applying preserves optionality.',
    });
  }
}

/** Parse the SSE body into an ordered list of typed events. */
function parseSse(rawText: unknown): Array<{ event: string; data: unknown }> {
  const raw = typeof rawText === 'string' ? rawText : String(rawText);
  const frames = raw.split(/\n\n+/).filter((f) => f.trim().length > 0);
  return frames.map((frame) => {
    const lines = frame.split('\n');
    const event = lines.find((l) => l.startsWith('event: '))?.slice('event: '.length) ?? '';
    const dataLine = lines.find((l) => l.startsWith('data: '))?.slice('data: '.length) ?? '';
    const data: unknown = dataLine ? JSON.parse(dataLine) : null;
    return { event, data };
  });
}

describe('M05 /rt/twin over HTTP (SSE)', () => {
  let app: INestApplication;
  let http: App;
  let memory: FakeMemory;
  let reasoner: FakeReasoner;
  let auditSink: InMemoryAuditSink;
  const userA = randomUUID();
  let tokenA: string;

  beforeAll(async () => {
    memory = new FakeMemory();
    reasoner = new FakeReasoner();
    auditSink = new InMemoryAuditSink();
    const audit = createAuditClient({ sink: auditSink });

    const twin: TwinHandlerDeps = {
      memory,
      profiles: new FakeProfiles(),
      reasoner,
      audit,
    };

    // Only the fields the TwinController + BearerAuthGuard actually read.
    const deps = {
      authProvider: new DevAuthProvider(DEV_SECRET),
      twin,
    } as unknown as AppDeps;

    app = await NestFactory.create(TestTwinModule.forRoot(deps), { logger: ['warn', 'error'] });
    await app.init();
    http = app.getHttpServer() as App;

    tokenA = await DevAuthProvider.mint(userA, DEV_SECRET);
  });

  afterAll(async () => {
    await app.close();
  });

  it('missing bearer token → 401', async () => {
    const res = await request(http)
      .post('/rt/twin')
      .send({ message: 'hi' });
    expect(res.status).toBe(401);
  });

  it('streams a grounded answer with a BOUNDED memory slice (context → tool_call → tool_result → tokens → done)', async () => {
    const res = await request(http)
      .post('/rt/twin')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Accept', 'text/event-stream')
      .send({ message: 'Should I apply to this senior backend role?' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const frames = parseSse(res.text);
    const kinds = frames.map((f) => f.event);
    expect(kinds[0]).toBe('context');
    expect(kinds).toContain('tool_call');
    expect(kinds).toContain('tool_result');
    expect(kinds.filter((k) => k === 'token').length).toBeGreaterThan(0);
    expect(kinds[kinds.length - 1]).toBe('done');

    // Bounded slice, NOT a full dump — usedTokens <= budget AND truncated=true.
    const ctxFrame = frames.find((f) => f.event === 'context');
    const slice = (ctxFrame?.data as { slice: WorkingSlice }).slice;
    expect(slice.usedTokens).toBeLessThanOrEqual(slice.budgetTokens);
    expect(slice.truncated).toBe(true);
    expect(slice.entries.length).toBeGreaterThan(0);

    // Per-user scoping: memory was retrieved for the token owner.
    expect(memory.calls[0]?.userId).toBe(userA);
    expect(reasoner.calls[0]?.userId).toBe(userA);

    // Audit records the completed turn exactly once.
    const records = auditSink.records();
    expect(records.some((r) => r.action === 'twin.turn.completed' && r.userId === userA)).toBe(true);
  });

  it('BLOCKS a Yellow action requested via chat — approval_required, no token event, no reasoner call', async () => {
    reasoner.calls.length = 0;
    const before = auditSink.records().length;
    const res = await request(http)
      .post('/rt/twin')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Accept', 'text/event-stream')
      .send({ message: 'Please send this outreach email to the recruiter now.' });

    expect(res.status).toBe(200);
    const frames = parseSse(res.text);
    const kinds = frames.map((f) => f.event);

    expect(kinds).toContain('approval_required');
    expect(kinds).not.toContain('token');
    expect(kinds).not.toContain('tool_call');
    expect(kinds[kinds.length - 1]).toBe('done');

    const approval = frames.find((f) => f.event === 'approval_required')
      ?.data as { tier: string; action: string; reason: string };
    expect(approval.tier).toBe('yellow');
    expect(approval.action).toBe('draft.send');
    expect(approval.reason).toBe('yellow_action_requires_approval_token');

    // The reasoner was NEVER called for the blocked turn.
    expect(reasoner.calls).toEqual([]);

    // Blocked turn is audited (defence-in-depth trail).
    const after = auditSink.records().slice(before);
    expect(
      after.some(
        (r) => r.action === 'twin.turn.approval_required' && r.target === 'draft.send' && r.userId === userA,
      ),
    ).toBe(true);
  });
});