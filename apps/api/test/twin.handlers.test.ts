/**
 * DB-free unit tests for the Twin conversational surface handler (M05 Step 4).
 * Drives runTwinTurn against fake ports so the invariants are pinned per branch:
 *
 *   - a strategic-question turn streams `context` → `tool_call` → `tool_result`
 *     → tokens → `done` (grounded_answer);
 *   - the memory context is ALWAYS a bounded slice (usedTokens ≤ budget, and a
 *     truncated dump is visible via `truncated: true`) — NEVER a full dump;
 *   - a Yellow intent request (send outreach / mark as applied / delete /
 *     publish portfolio) emits `approval_required` and STOPS — the reasoner is
 *     never called and no side-effect tool is invoked;
 *   - the userId used for memory + reasoner reads comes ONLY from the verified
 *     RequestContext (per-user scoping, never client-supplied);
 *   - every turn appends ONE AuditLog record (who/what/when/model_version).
 */
import { describe, expect, it } from 'vitest';
import {
  contextFromVerifiedClaims,
  runTwinTurn,
  DEFAULT_TWIN_MEMORY_BUDGET_TOKENS,
  TWIN_MODEL_VERSION,
  type RequestContext,
  type TwinEvent,
  type TwinHandlerDeps,
  type TwinMemoryPort,
  type TwinProfilePort,
  type TwinReasonerPort,
} from '../src/index.js';
import { createAuditClient, InMemoryAuditSink } from '@careeros/observability';
import type { WorkingSlice } from '@careeros/memory';
import type { DecisionContract } from '@careeros/cie-reasoning';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const ctx = (userId: string): RequestContext =>
  contextFromVerifiedClaims({ userId, traceId: 'trace-1' });

// ---------- fakes ----------

class FakeMemory implements TwinMemoryPort {
  calls: Array<Parameters<TwinMemoryPort['retrieve']>[0]> = [];
  constructor(private readonly slice: WorkingSlice) {}
  retrieve(task: Parameters<TwinMemoryPort['retrieve']>[0]): Promise<WorkingSlice> {
    this.calls.push(task);
    return Promise.resolve(this.slice);
  }
}

class FakeProfiles implements TwinProfilePort {
  calls: string[] = [];
  constructor(private readonly profileId: string | null) {}
  resolveProfileId(userId: string): Promise<string | null> {
    this.calls.push(userId);
    return Promise.resolve(this.profileId);
  }
}

class FakeReasoner implements TwinReasonerPort {
  calls: Array<{ userId: string; question: string }> = [];
  constructor(private readonly contract: DecisionContract) {}
  decide(userId: string, question: string): Promise<DecisionContract> {
    this.calls.push({ userId, question });
    return Promise.resolve(this.contract);
  }
}

function makeDeps(overrides: Partial<TwinHandlerDeps> = {}): {
  deps: TwinHandlerDeps;
  memory: FakeMemory;
  profiles: FakeProfiles;
  reasoner: FakeReasoner;
  auditSink: InMemoryAuditSink;
} {
  const slice: WorkingSlice = {
    summary: 'Backend engineer with Python + Postgres background.',
    entries: [
      { tier: 'profile', text: 'python for 5 years', ref: 'experience:1', tokens: 10, score: 0.9 },
      { tier: 'semantic', text: 'strong in data platforms', ref: 'insight:1', tokens: 8, score: 0.8 },
    ],
    usedTokens: 40,
    budgetTokens: 512,
    truncated: true, // proves it's a strict subset (something was dropped)
  };
  const memory = new FakeMemory(slice);
  const profiles = new FakeProfiles('profile-a');
  const reasoner = new FakeReasoner({
    alternatives: ['apply', 'wait', 'negotiate'],
    evidenceRefs: ['experience:1'],
    reasoning: 'Strong Python + Postgres match; requirements aligned.',
    confidence: 0.72,
    assumptions: ['Requirements are current'],
    recommendation: 'apply',
    optionalityNote: 'Applying preserves optionality; keep interviewing.',
  });
  const auditSink = new InMemoryAuditSink();
  const audit = createAuditClient({ sink: auditSink });

  const deps: TwinHandlerDeps = {
    memory,
    profiles,
    reasoner,
    audit,
    ...overrides,
  };
  return { deps, memory, profiles, reasoner, auditSink };
}

async function collect(gen: AsyncGenerator<TwinEvent, void, void>): Promise<TwinEvent[]> {
  const out: TwinEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

// ---------- tests ----------

describe('runTwinTurn — streaming Twin surface (M05 Step 4)', () => {
  it('streams a grounded answer using only a BOUNDED memory slice (never a full dump)', async () => {
    const { deps, memory, reasoner, profiles, auditSink } = makeDeps();

    const events = await collect(
      runTwinTurn(
        ctx(USER_A),
        { message: 'Should I apply to this senior backend role?' },
        deps,
      ),
    );

    // The sequence: context → tool_call → tool_result → tokens... → done.
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('context');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types.filter((t) => t === 'token').length).toBeGreaterThan(0);
    expect(types[types.length - 1]).toBe('done');

    // The bounded slice is what got streamed as context — NOT the full memory.
    const ctxEvent = events.find((e) => e.type === 'context');
    expect(ctxEvent?.type).toBe('context');
    if (ctxEvent?.type === 'context') {
      expect(ctxEvent.slice.usedTokens).toBeLessThanOrEqual(ctxEvent.slice.budgetTokens);
      expect(ctxEvent.slice.truncated).toBe(true); // proves it's a strict subset
      expect(ctxEvent.slice.entries.length).toBeGreaterThan(0);
    }

    // Per-user scoping: memory + profile were queried with the userId FROM CTX only.
    expect(memory.calls[0]?.userId).toBe(USER_A);
    expect(memory.calls[0]?.budgetTokens).toBe(DEFAULT_TWIN_MEMORY_BUDGET_TOKENS);
    expect(profiles.calls).toEqual([USER_A]);

    // Reasoner tool_call carried the same user id (server-side).
    expect(reasoner.calls[0]?.userId).toBe(USER_A);

    // The grounded contract IS visible in the stream — tokens are a projection of it.
    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult?.type).toBe('tool_result');
    if (toolResult?.type === 'tool_result') {
      expect(toolResult.result.recommendation).toBe('apply');
      expect(toolResult.result.evidenceRefs).toContain('experience:1');
    }

    // The turn is audited exactly once, with the reasoner's model_version stamp.
    const records = auditSink.records();
    expect(records).toHaveLength(1);
    expect(records[0]?.actor).toBe('twin');
    expect(records[0]?.userId).toBe(USER_A);
    expect(records[0]?.action).toBe('twin.turn.completed');
    expect(records[0]?.modelVersion).toBe('strategic-reasoner@1.0.0');
  });

  it('BLOCKS a Yellow action requested via chat — emits approval_required and stops (no reasoner call, no side effect)', async () => {
    const { deps, reasoner, auditSink } = makeDeps();

    const events = await collect(
      runTwinTurn(
        ctx(USER_A),
        { message: 'Please send this outreach email to the recruiter now.' },
        deps,
      ),
    );

    // Only approval_required + done (in that order). NO tokens, NO tool_call.
    const types = events.map((e) => e.type);
    expect(types).toEqual(['approval_required', 'done']);

    const approval = events[0];
    expect(approval?.type).toBe('approval_required');
    if (approval?.type === 'approval_required') {
      expect(approval.tier).toBe('yellow');
      expect(approval.action).toBe('draft.send');
      expect(approval.reason).toBe('yellow_action_requires_approval_token');
    }

    const done = events[1];
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.outcome).toBe('approval_required');
      expect(done.modelVersion).toBe(TWIN_MODEL_VERSION);
    }

    // The reasoner was NEVER invoked — chat is not a side-effect gate.
    expect(reasoner.calls).toEqual([]);

    // Audit records the blocked attempt (who/what/when/model_version).
    const records = auditSink.records();
    expect(records).toHaveLength(1);
    expect(records[0]?.action).toBe('twin.turn.approval_required');
    expect(records[0]?.target).toBe('draft.send');
    expect(records[0]?.actor).toBe('twin');
    expect(records[0]?.userId).toBe(USER_A);
  });

  it('also blocks the "mark as applied" Yellow phrasing (application.submit_assist)', async () => {
    const { deps, reasoner } = makeDeps();
    const events = await collect(
      runTwinTurn(
        ctx(USER_A),
        { message: 'Please mark this as applied so my pipeline is up to date.' },
        deps,
      ),
    );
    const approval = events.find((e) => e.type === 'approval_required');
    expect(approval?.type).toBe('approval_required');
    if (approval?.type === 'approval_required') {
      expect(approval.action).toBe('application.submit_assist');
      expect(approval.tier).toBe('yellow');
    }
    expect(reasoner.calls).toEqual([]);
  });

  it('emits a validation error on an empty message and does not touch memory/reasoner', async () => {
    const { deps, memory, reasoner, auditSink } = makeDeps();
    const events = await collect(runTwinTurn(ctx(USER_A), { message: '   ' }, deps));
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('error');
    expect(memory.calls).toEqual([]);
    expect(reasoner.calls).toEqual([]);
    expect(auditSink.records()).toEqual([]);
  });

  it('handles a brand-new user with no profile — empty min-slice, informational answer, no reasoner call', async () => {
    const { deps, reasoner } = makeDeps({});
    // Override the profile port to simulate "no profile yet".
    const emptyProfiles = new FakeProfiles(null);
    const events = await collect(
      runTwinTurn(
        ctx(USER_A),
        { message: 'What do you know about me?' }, // NOT a "should I" question
        { ...deps, profiles: emptyProfiles },
      ),
    );
    const ctxEvent = events.find((e) => e.type === 'context');
    expect(ctxEvent?.type).toBe('context');
    if (ctxEvent?.type === 'context') {
      expect(ctxEvent.slice.entries).toEqual([]);
      expect(ctxEvent.slice.usedTokens).toBe(0);
    }
    // No "should I" phrasing → no reasoner call.
    expect(reasoner.calls).toEqual([]);
    expect(events[events.length - 1]?.type).toBe('done');
  });
});