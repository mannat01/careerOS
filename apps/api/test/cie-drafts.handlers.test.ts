/**
 * ⚑ Security-relevant: /v1/drafts autonomy boundary (M09 Step 4).
 *
 *   - POST /v1/drafts + GET /v1/drafts/:id are GREEN (advisory artifact).
 *   - POST /v1/drafts/:id/send is YELLOW: wrapped in
 *     withCapabilityGate('draft.send') → send WITHOUT a valid ApprovalToken
 *     is blocked (capability_denied), the sender NEVER runs, and the denial
 *     is audited.
 *   - Even WITH a valid token, a destination channel whose ToS forbids
 *     automated send returns capability_denied with manual-send guidance —
 *     no silent send.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryApprovalTokenStore,
  mintApprovalToken,
  type EnforceDeps,
} from '@careeros/capability-gate';
import { createAuditClient, InMemoryAuditSink } from '@careeros/observability';
import type { ApiError } from '@careeros/contracts';
import {
  DraftingService,
  groundDraft,
  type Draft,
  type DraftInput,
  type DrafterAgent,
} from '@careeros/cie-drafting';
import { contextFromVerifiedClaims, withCapabilityGate } from '../src/index.js';
import {
  createDraft,
  getDraft,
  sendDraft,
  InMemoryDraftStore,
  StaticChannelPolicy,
  type DraftDto,
  type DraftRecord,
  type DraftsHandlerDeps,
  type SendDraftPayload,
} from '../src/modules/cie/drafts.handlers.js';
import { DraftOpportunityNotFoundError } from '../src/modules/cie/drafts.adapters.js';

const SECRET = 'k'.repeat(32);
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-07-22T12:00:00.000Z');

const PROFILE = [
  { id: 'fact-ts', kind: 'skill' as const, summary: 'TypeScript (5 years, production)' },
  { id: 'fact-acme', kind: 'experience' as const, summary: 'Senior Engineer at Acme — led checkout-service rewrite' },
];
const GRAPH = [
  { id: 'node-k8s', kind: 'skill' as const, label: 'Kubernetes', metric: 'migrated 12 services' },
];
const ALLOWED = ['fact-ts', 'fact-acme', 'node-k8s'];

/**
 * Untrusted fixture agent: proposes a draft that mixes grounded claims with a
 * FABRICATED one ("10 years of Rust at Google" — ref not on the allow-list)
 * plus a forbidden-inflation phrase. It then applies the SAME deterministic
 * `groundDraft` guardrail the production LlmDrafterAgent applies — proving
 * the discard-and-recompute path end-to-end through the handler.
 */
class FixtureDrafterAgent implements DrafterAgent {
  draft(input: DraftInput): Promise<Draft> {
    const proposal = {
      subject: `Application: ${input.opportunity.title}`,
      body:
        'I led the checkout-service rewrite at Acme and work in TypeScript daily. ' +
        'I spent 10 years writing Rust at Google. I am a world-class expert.',
      claims: [
        { claim: 'Led checkout-service rewrite at Acme', factRef: 'fact-acme' },
        { claim: 'TypeScript, 5 years production', factRef: 'fact-ts' },
        { claim: '10 years of Rust at Google', factRef: 'fact-google' }, // fabricated
      ],
    };
    return Promise.resolve(groundDraft(input, proposal).draft);
  }
}

function makeService(): DraftingService {
  return new DraftingService({
    profile: { readProfileFacts: () => Promise.resolve(PROFILE) },
    state: { readStateDimensions: () => Promise.resolve([]) },
    graph: { readGraph: () => Promise.resolve(GRAPH) },
    opportunity: {
      readOpportunity: (_userId, opportunityId) => {
        if (opportunityId !== 'opp-1') throw new DraftOpportunityNotFoundError(opportunityId);
        return Promise.resolve({
          title: 'Staff Engineer',
          company: 'Nimbus',
          requirements: ['TypeScript', 'Kubernetes'],
          text: 'Staff Engineer at Nimbus. TypeScript and Kubernetes required.',
        });
      },
    },
    evidence: { readAllowedFactRefs: () => Promise.resolve(ALLOWED) },
    agent: new FixtureDrafterAgent(),
  });
}

describe('/v1/drafts handlers (draft Green, send Yellow)', () => {
  let deps: DraftsHandlerDeps;
  let sentCalls: Array<{ userId: string; draftId: string; channel: string }>;
  let auditSink: InMemoryAuditSink;
  let tokenStore: InMemoryApprovalTokenStore;
  let gateDeps: EnforceDeps;

  const ctxA = contextFromVerifiedClaims({ userId: USER_A, traceId: 'trace-a', headers: {} });

  beforeEach(() => {
    sentCalls = [];
    deps = {
      service: makeService(),
      store: new InMemoryDraftStore(),
      channels: new StaticChannelPolicy(),
      sender: {
        send: (userId, draft, channel) => {
          sentCalls.push({ userId, draftId: draft.id, channel });
          return Promise.resolve();
        },
      },
      now: () => NOW,
    };
    auditSink = new InMemoryAuditSink();
    tokenStore = new InMemoryApprovalTokenStore();
    gateDeps = {
      secret: SECRET,
      tokenStore,
      audit: createAuditClient({ sink: auditSink, clock: () => NOW }),
      now: () => NOW.getTime(),
    };
  });

  /** The send route exactly as the controller wires it: gate BEFORE handler. */
  const sendRoute = () =>
    withCapabilityGate<SendDraftPayload, DraftDto>('draft.send', gateDeps, (ctx, payload) =>
      sendDraft(ctx, payload, deps),
    );

  async function createOne(recipientChannel?: string): Promise<DraftDto> {
    const res = await createDraft(
      ctxA,
      {
        kind: 'outreach',
        opportunityId: 'opp-1',
        recipient: { name: 'Dana', role: 'Hiring Manager', channel: recipientChannel },
      },
      deps,
    );
    expect(res.status).toBe(200);
    return res.body as DraftDto;
  }

  // ---------- POST /v1/drafts (GREEN) ----------

  it('generates a draft; every claim resolves to a real fact and fabrications are dropped', async () => {
    const draft = await createOne('email');

    expect(draft.kind).toBe('outreach');
    expect(draft.status).toBe('draft');
    expect(draft.modelVersion).toBe('drafter@1.0.0'); // stamped
    expect(draft.claims.length).toBeGreaterThan(0);
    for (const c of draft.claims) expect(ALLOWED).toContain(c.factRef); // zero fabrication
    // The fabricated employer/claim never renders anywhere.
    const rendered = `${draft.subject} ${draft.body} ${draft.claims.map((c) => c.claim).join(' ')}`;
    expect(rendered).not.toMatch(/google/i);
    expect(rendered).not.toMatch(/world-class/i);
  });

  it('unknown opportunity → not_found; bad body → validation_failed', async () => {
    const missing = await createDraft(ctxA, { kind: 'cover_letter', opportunityId: 'nope' }, deps);
    expect(missing.status).toBe(404);
    expect((missing.body as ApiError).error.code).toBe('not_found');

    const bad = await createDraft(ctxA, { kind: 'poem', opportunityId: 'opp-1' }, deps);
    expect(bad.status).toBe(422);
    expect((bad.body as ApiError).error.code).toBe('validation_failed');
  });

  // ---------- GET /v1/drafts/:id (GREEN, per-user) ----------

  it('reads own draft; another user cannot see it', async () => {
    const draft = await createOne('email');

    const mine = await getDraft(ctxA, draft.id, deps);
    expect(mine.status).toBe(200);
    expect((mine.body as DraftDto).id).toBe(draft.id);

    const ctxB = contextFromVerifiedClaims({ userId: USER_B, traceId: 'trace-b', headers: {} });
    const theirs = await getDraft(ctxB, draft.id, deps);
    expect(theirs.status).toBe(404);
  });

  // ---------- POST /v1/drafts/:id/send (YELLOW) ----------

  it('send WITHOUT an approval token → capability_denied, sender never runs, audited', async () => {
    const draft = await createOne('email');

    const res = await sendRoute()(ctxA, { draftId: draft.id, channel: 'email' });
    expect(res.status).toBe(403);
    expect((res.body as ApiError).error.code).toBe('capability_denied');
    expect(sentCalls).toHaveLength(0); // no silent send

    const stillDraft = await getDraft(ctxA, draft.id, deps);
    expect((stillDraft.body as DraftDto).status).toBe('draft');

    const audit = auditSink.records();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      userId: USER_A,
      action: 'capability_gate.denied',
      target: 'draft.send',
    });
  });

  it('send WITH a valid token to a ToS-forbidden channel → capability_denied + manual-send guidance', async () => {
    const draft = await createOne('linkedin');
    const payload: SendDraftPayload = { draftId: draft.id, channel: 'linkedin' };
    const token = await mintApprovalToken({
      userId: USER_A,
      action: 'draft.send',
      payload,
      ttlMs: 60_000,
      secret: SECRET,
      store: tokenStore,
      now: () => NOW.getTime(),
    });
    const ctx = contextFromVerifiedClaims({
      userId: USER_A,
      traceId: 'trace-tos',
      headers: { 'x-approval-token': token },
    });

    const res = await sendRoute()(ctx, payload);
    expect(res.status).toBe(403);
    const err = (res.body as ApiError).error;
    expect(err.code).toBe('capability_denied');
    expect(err.details).toMatchObject({
      channel: 'linkedin',
      reason: 'channel_tos_prohibits_automated_send',
    });
    expect(String((err.details as Record<string, unknown>).guidance)).toMatch(/manually/i);
    expect(sentCalls).toHaveLength(0); // approval can NEVER override channel ToS
  });

  it('send WITH a valid token on a permitted channel → sent once; replay denied', async () => {
    const draft = await createOne('email');
    const payload: SendDraftPayload = { draftId: draft.id, channel: 'email' };
    const token = await mintApprovalToken({
      userId: USER_A,
      action: 'draft.send',
      payload,
      ttlMs: 60_000,
      secret: SECRET,
      store: tokenStore,
      now: () => NOW.getTime(),
    });
    const ctx = contextFromVerifiedClaims({
      userId: USER_A,
      traceId: 'trace-send',
      headers: { 'x-approval-token': token },
    });

    const res = await sendRoute()(ctx, payload);
    expect(res.status).toBe(200);
    expect((res.body as DraftDto).status).toBe('sent');
    expect(sentCalls).toEqual([{ userId: USER_A, draftId: draft.id, channel: 'email' }]);

    // Single-use token: replaying the exact same approved send is denied.
    const replay = await sendRoute()(ctx, payload);
    expect(replay.status).toBe(403);
    expect(sentCalls).toHaveLength(1);
  });

  it('unknown channels fail closed (capability_denied), even with a valid token', async () => {
    const draft = await createOne(undefined);
    const payload: SendDraftPayload = { draftId: draft.id, channel: 'carrier-pigeon' };
    const token = await mintApprovalToken({
      userId: USER_A,
      action: 'draft.send',
      payload,
      ttlMs: 60_000,
      secret: SECRET,
      store: tokenStore,
      now: () => NOW.getTime(),
    });
    const ctx = contextFromVerifiedClaims({
      userId: USER_A,
      traceId: 'trace-unknown',
      headers: { 'x-approval-token': token },
    });

    const res = await sendRoute()(ctx, payload);
    expect(res.status).toBe(403);
    expect(((res.body as ApiError).error.details as Record<string, unknown>).reason).toBe(
      'channel_tos_prohibits_automated_send',
    );
    expect(sentCalls).toHaveLength(0);
  });
});

// Type-level guard: the sender port receives the full record.
void ((r: DraftRecord) => r.userId);