/**
 * DB-free unit tests for the /v1/applications handlers (M04 Stage 4 pipeline).
 *
 * A small in-memory fake store honors the SAME per-user scoping + append-only
 * timeline + appliedAt-stamping contract the Prisma store implements, so the
 * handler logic is exercised end-to-end without a database. Locks:
 *   - create defaults to `saved`, links the opportunity (+ optional variant), and
 *     seeds the timeline; an unknown opportunity 404s;
 *   - the full pipeline advances one legal step at a time; a skip/backwards move
 *     is a 409 conflict;
 *   - the CORE invariant at the HTTP layer: a user-initiated PATCH WITH the
 *     explicit "I submitted this" flag reaches `applied` (audited on the timeline
 *     + appliedAt stamped + a MemoryEvent emitted); an agent/system-context PATCH
 *     — even with a valid session — is REJECTED (capability_denied / 403), and no
 *     mutation or MemoryEvent occurs;
 *   - a meaningful status change emits ONE MemoryEvent; a notes-only edit emits none;
 *   - per-user scoping: user A can neither read nor mutate user B's application.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { ApiError } from '@careeros/contracts';
import {
  contextFromVerifiedClaims,
  createApplication,
  getApplication,
  listApplications,
  patchApplication,
  scheduleFollowUp,
  type ApplicationHandlerDeps,
  type ApplicationMemoryPort,
  type ApplicationStorePort,
  type ApplicationUpdateCommand,
  type OpportunityExistsPort,
  type RequestContext,
} from '../src/index.js';
import type {
  Application,
  ApplicationActor,
  ApplicationDetail,
  ApplicationFollowUp,
  ApplicationStatus,
} from '@careeros/contracts';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OPP_1 = '11111111-1111-4111-8111-111111111111';
const OPP_2 = '22222222-2222-4222-8222-222222222222';

const ctxUser = (userId: string): RequestContext =>
  contextFromVerifiedClaims({ userId, traceId: 'trace-app' });

// ---------------- fakes ----------------

interface Row {
  id: string;
  userId: string;
  opportunityId: string;
  resumeVariantId: string | null;
  status: ApplicationStatus;
  notes: string | null;
  followUpAt: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  timeline: ApplicationDetail['timeline'];
}

let seq = 0;
const nextId = (): string => `app-${++seq}`;

class FakeStore implements ApplicationStorePort {
  readonly rows = new Map<string, Row>();

  create(
    userId: string,
    input: { opportunityId: string; resumeVariantId?: string; notes?: string },
  ): Promise<ApplicationDetail> {
    const id = nextId();
    const now = new Date().toISOString();
    const row: Row = {
      id,
      userId,
      opportunityId: input.opportunityId,
      resumeVariantId: input.resumeVariantId ?? null,
      status: 'saved',
      notes: input.notes ?? null,
      followUpAt: null,
      appliedAt: null,
      createdAt: now,
      updatedAt: now,
      timeline: [
        { id: `tl-${id}-0`, fromStatus: null, toStatus: 'saved', actor: 'user', note: null, at: now },
      ],
    };
    this.rows.set(id, row);
    return Promise.resolve(this.toDetail(row));
  }

  getById(userId: string, id: string): Promise<ApplicationDetail | null> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId) return Promise.resolve(null);
    return Promise.resolve(this.toDetail(row));
  }

  list(userId: string): Promise<Application[]> {
    const rows = [...this.rows.values()].filter((r) => r.userId === userId);
    return Promise.resolve(rows.map((r) => this.toApplication(r)));
  }

  update(userId: string, id: string, command: ApplicationUpdateCommand): Promise<ApplicationDetail | null> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId) return Promise.resolve(null);
    const now = new Date().toISOString();
    if (command.notes !== undefined) row.notes = command.notes;
    if (command.followUpAt !== undefined) row.followUpAt = command.followUpAt;
    if (command.statusChange) {
      const from = row.status;
      row.status = command.statusChange.to;
      if (command.statusChange.setAppliedAt) row.appliedAt = now;
      row.timeline.push({
        id: `tl-${id}-${row.timeline.length}`,
        fromStatus: from,
        toStatus: command.statusChange.to,
        actor: command.statusChange.actor,
        note: command.statusChange.note ?? null,
        at: now,
      });
    }
    row.updatedAt = now;
    return Promise.resolve(this.toDetail(row));
  }

  addFollowUp(
    userId: string,
    id: string,
    input: { dueAt: string; note?: string },
  ): Promise<ApplicationFollowUp | null> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId) return Promise.resolve(null);
    return Promise.resolve({
      id: `fu-${id}`,
      applicationId: id,
      dueAt: input.dueAt,
      note: input.note ?? null,
      done: false,
      createdAt: new Date().toISOString(),
    });
  }

  private toApplication(row: Row): Application {
    const { timeline: _t, userId: _u, ...rest } = row;
    return rest;
  }

  private toDetail(row: Row): ApplicationDetail {
    return { ...this.toApplication(row), timeline: structuredClone(row.timeline) };
  }
}

class FakeOpportunities implements OpportunityExistsPort {
  constructor(private readonly ids: Set<string>) {}
  exists(id: string): Promise<boolean> {
    return Promise.resolve(this.ids.has(id));
  }
}

interface Recorded {
  userId: string;
  fromStatus: ApplicationStatus;
  toStatus: ApplicationStatus;
  actor: ApplicationActor;
}

class SpyMemory implements ApplicationMemoryPort {
  readonly events: Recorded[] = [];
  recordStatusChange(input: {
    userId: string;
    applicationId: string;
    opportunityId: string;
    fromStatus: ApplicationStatus;
    toStatus: ApplicationStatus;
    actor: ApplicationActor;
  }): Promise<void> {
    this.events.push({
      userId: input.userId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actor: input.actor,
    });
    return Promise.resolve();
  }
}

function makeDeps(): { deps: ApplicationHandlerDeps; store: FakeStore; memory: SpyMemory } {
  const store = new FakeStore();
  const memory = new SpyMemory();
  const deps: ApplicationHandlerDeps = {
    store,
    opportunities: new FakeOpportunities(new Set([OPP_1, OPP_2])),
    memory,
  };
  return { deps, store, memory };
}

/** Drive an application from `saved` up to (but not including) the given target. */
async function advanceTo(
  id: string,
  target: ApplicationStatus,
  deps: ApplicationHandlerDeps,
): Promise<void> {
  const path: ApplicationStatus[] = ['drafting', 'ready', 'applied', 'screening', 'interviewing', 'offer'];
  for (const step of path) {
    if (step === target) return;
    const body: Record<string, unknown> = { status: step };
    if (step === 'applied') body.iSubmitted = true;
    const r = await patchApplication(ctxUser(USER_A), id, 'user', body, deps);
    expect(r.status).toBe(200);
  }
}

beforeEach(() => {
  seq = 0;
});

describe('POST /v1/applications — create', () => {
  it('creates a `saved` application linking the opportunity + seeds the timeline', async () => {
    const { deps } = makeDeps();
    const r = await createApplication(ctxUser(USER_A), { opportunityId: OPP_1, notes: 'dream job' }, deps);
    expect(r.status).toBe(201);
    const body = r.body as ApplicationDetail;
    expect(body.status).toBe('saved');
    expect(body.opportunityId).toBe(OPP_1);
    expect(body.notes).toBe('dream job');
    expect(body.appliedAt).toBeNull();
    expect(body.timeline).toHaveLength(1);
    expect(body.timeline[0]).toMatchObject({ fromStatus: null, toStatus: 'saved' });
  });

  it('links an optional resume variant', async () => {
    const { deps } = makeDeps();
    const r = await createApplication(
      ctxUser(USER_A),
      { opportunityId: OPP_1, resumeVariantId: 'variant-xyz' },
      deps,
    );
    expect((r.body as ApplicationDetail).resumeVariantId).toBe('variant-xyz');
  });

  it('404s an unknown opportunity', async () => {
    const { deps } = makeDeps();
    const r = await createApplication(
      ctxUser(USER_A),
      { opportunityId: '99999999-9999-4999-8999-999999999999' },
      deps,
    );
    expect(r.status).toBe(404);
    expect((r.body as ApiError).error.code).toBe('not_found');
  });

  it('422s an invalid payload (missing opportunityId)', async () => {
    const { deps } = makeDeps();
    const r = await createApplication(ctxUser(USER_A), { notes: 'x' }, deps);
    expect(r.status).toBe(422);
    expect((r.body as ApiError).error.code).toBe('validation_failed');
  });
});

describe('PATCH /v1/applications/:id — pipeline advance', () => {
  it('advances one legal step at a time through the whole pipeline', async () => {
    const { deps } = makeDeps();
    const created = (await createApplication(ctxUser(USER_A), { opportunityId: OPP_1 }, deps)).body as ApplicationDetail;

    const order: ApplicationStatus[] = ['drafting', 'ready', 'applied', 'screening', 'interviewing', 'offer', 'closed'];
    for (const to of order) {
      const body: Record<string, unknown> = { status: to };
      if (to === 'applied') body.iSubmitted = true;
      const r = await patchApplication(ctxUser(USER_A), created.id, 'user', body, deps);
      expect(r.status).toBe(200);
      expect((r.body as ApplicationDetail).status).toBe(to);
    }
  });

  it('409s a skip (saved → ready)', async () => {
    const { deps } = makeDeps();
    const created = (await createApplication(ctxUser(USER_A), { opportunityId: OPP_1 }, deps)).body as ApplicationDetail;
    const r = await patchApplication(ctxUser(USER_A), created.id, 'user', { status: 'ready' }, deps);
    expect(r.status).toBe(409);
    expect((r.body as ApiError).error.code).toBe('conflict');
  });

  it('supports a notes-only edit (no transition, no MemoryEvent)', async () => {
    const { deps, memory } = makeDeps();
    const created = (await createApplication(ctxUser(USER_A), { opportunityId: OPP_1 }, deps)).body as ApplicationDetail;
    const r = await patchApplication(ctxUser(USER_A), created.id, 'user', { notes: 'call back Friday' }, deps);
    expect(r.status).toBe(200);
    expect((r.body as ApplicationDetail).notes).toBe('call back Friday');
    expect(memory.events).toHaveLength(0);
  });
});

describe('CORE — the `applied` transition is set ONLY by an explicit user action', () => {
  it('(a) a user-initiated PATCH WITH the explicit flag → applied SUCCEEDS and is audited', async () => {
    const { deps, store, memory } = makeDeps();
    const created = (await createApplication(ctxUser(USER_A), { opportunityId: OPP_1 }, deps)).body as ApplicationDetail;
    await advanceTo(created.id, 'applied', deps); // saved → drafting → ready

    const r = await patchApplication(
      ctxUser(USER_A),
      created.id,
      'user',
      { status: 'applied', iSubmitted: true },
      deps,
    );
    expect(r.status).toBe(200);
    const body = r.body as ApplicationDetail;
    expect(body.status).toBe('applied');
    // Audited: appliedAt stamped + an append-only timeline row records the user actor.
    expect(body.appliedAt).not.toBeNull();
    const appliedEntry = body.timeline.find((t) => t.toStatus === 'applied');
    expect(appliedEntry).toBeDefined();
    expect(appliedEntry!.actor).toBe('user');
    // A MemoryEvent for the applied transition was emitted.
    expect(memory.events.some((e) => e.toStatus === 'applied' && e.actor === 'user')).toBe(true);
    // Persisted state reflects applied.
    expect(store.rows.get(created.id)!.status).toBe('applied');
  });

  it('(b) an AGENT/SYSTEM-context PATCH → applied is REJECTED (capability_denied/403), with a valid session', async () => {
    const { deps, store, memory } = makeDeps();
    const created = (await createApplication(ctxUser(USER_A), { opportunityId: OPP_1 }, deps)).body as ApplicationDetail;
    await advanceTo(created.id, 'applied', deps); // move to `ready` legitimately

    for (const actor of ['twin', 'system'] as const) {
      const r = await patchApplication(
        ctxUser(USER_A), // a VALID authenticated session…
        created.id,
        actor, // …but a non-human actor context
        { status: 'applied', iSubmitted: true }, // even asserting the flag
        deps,
      );
      expect(r.status).toBe(403);
      expect((r.body as ApiError).error.code).toBe('capability_denied');
    }
    // No mutation happened: still `ready`, never applied, and no MemoryEvent for applied.
    expect(store.rows.get(created.id)!.status).toBe('ready');
    expect(store.rows.get(created.id)!.appliedAt).toBeNull();
    expect(memory.events.some((e) => e.toStatus === 'applied')).toBe(false);
  });

  it('a USER PATCH to applied WITHOUT the explicit flag is REJECTED (capability_denied/403)', async () => {
    const { deps, store } = makeDeps();
    const created = (await createApplication(ctxUser(USER_A), { opportunityId: OPP_1 }, deps)).body as ApplicationDetail;
    await advanceTo(created.id, 'applied', deps);

    const r = await patchApplication(ctxUser(USER_A), created.id, 'user', { status: 'applied' }, deps);
    expect(r.status).toBe(403);
    expect((r.body as ApiError).error.code).toBe('capability_denied');
    expect(store.rows.get(created.id)!.status).toBe('ready');
  });
});

describe('MemoryEvent emission', () => {
  it('emits ONE MemoryEvent per meaningful status change', async () => {
    const { deps, memory } = makeDeps();
    const created = (await createApplication(ctxUser(USER_A), { opportunityId: OPP_1 }, deps)).body as ApplicationDetail;
    await patchApplication(ctxUser(USER_A), created.id, 'user', { status: 'drafting' }, deps);
    await patchApplication(ctxUser(USER_A), created.id, 'user', { status: 'ready' }, deps);
    expect(memory.events).toHaveLength(2);
    expect(memory.events.map((e) => e.toStatus)).toEqual(['drafting', 'ready']);
  });
});

describe('POST /v1/applications/:id/followups — internal reminder (Green)', () => {
  it('schedules a follow-up on the caller’s application', async () => {
    const { deps } = makeDeps();
    const created = (await createApplication(ctxUser(USER_A), { opportunityId: OPP_1 }, deps)).body as ApplicationDetail;
    const r = await scheduleFollowUp(
      ctxUser(USER_A),
      created.id,
      { dueAt: '2026-08-01T09:00:00.000Z', note: 'ping recruiter' },
      deps,
    );
    expect(r.status).toBe(201);
    const fu = r.body as ApplicationFollowUp;
    expect(fu.dueAt).toBe('2026-08-01T09:00:00.000Z');
    expect(fu.done).toBe(false);
  });

  it('404s a follow-up on someone else’s application', async () => {
    const { deps } = makeDeps();
    const created = (await createApplication(ctxUser(USER_A), { opportunityId: OPP_1 }, deps)).body as ApplicationDetail;
    const r = await scheduleFollowUp(ctxUser(USER_B), created.id, { dueAt: '2026-08-01T09:00:00.000Z' }, deps);
    expect(r.status).toBe(404);
  });
});

describe('per-user scoping — A cannot see or modify B’s applications', () => {
  it('B’s GET/PATCH against A’s application 404s; list is isolated', async () => {
    const { deps, store } = makeDeps();
    const aApp = (await createApplication(ctxUser(USER_A), { opportunityId: OPP_1 }, deps)).body as ApplicationDetail;
    await createApplication(ctxUser(USER_B), { opportunityId: OPP_2 }, deps);

    // B cannot read A's application.
    expect((await getApplication(ctxUser(USER_B), aApp.id, deps)).status).toBe(404);
    // B cannot mutate A's application (no state leaks either).
    const patch = await patchApplication(ctxUser(USER_B), aApp.id, 'user', { status: 'drafting' }, deps);
    expect(patch.status).toBe(404);
    expect(store.rows.get(aApp.id)!.status).toBe('saved');

    // Lists are isolated to the caller.
    const aList = (await listApplications(ctxUser(USER_A), deps)).body as { data: Application[] };
    const bList = (await listApplications(ctxUser(USER_B), deps)).body as { data: Application[] };
    expect(aList.data).toHaveLength(1);
    expect(bList.data).toHaveLength(1);
    expect(aList.data[0]!.id).not.toBe(bList.data[0]!.id);
  });
});
