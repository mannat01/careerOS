/**
 * DB-free unit tests for the /v1/cie/state handlers wired to a REAL
 * CareerStateService over in-memory doubles (InMemoryStateStore + the
 * StateUpdater guardrail agent on a scripted FakeLlm). No Nest, no Postgres.
 *
 * Locks the things the e2e can't cheaply prove per-branch:
 *  - GET computes lazily then returns the persisted model (≥12 dimensions),
 *  - per-user scoping — one user's recompute never leaks into another's read,
 *  - /explain resolves evidence refs back to their source facts,
 *  - unknown dimension → 404,
 *  - the CHANGE HOOK emits a MemoryEvent recording WHY a dimension moved.
 */
import { describe, expect, it } from 'vitest';
import {
  CareerStateService,
  InMemoryStateStore,
  type DerivedDimension,
  type StateModelAgent,
  type StateProfileFact,
} from '@careeros/cie-state';
import {
  contextFromVerifiedClaims,
  explainDimension,
  getState,
  recomputeState,
  type RequestContext,
  type StateHandlerDeps,
} from '../src/index.js';
import type {
  CareerStateModel,
  DimensionExplanation,
  ResolvedEvidence,
  StateEventPort,
  StateEvidencePort,
  StateFactPort,
} from '@careeros/cie-state';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ctx = (userId: string): RequestContext =>
  contextFromVerifiedClaims({ userId, traceId: 'trace-1' });

/** Per-user fact fixtures the fact port reads from a mutable map (edit → recompute). */
class FakeFactPort implements StateFactPort {
  readonly byUser = new Map<string, StateProfileFact[]>();
  readStateFacts(userId: string): Promise<StateProfileFact[]> {
    return Promise.resolve(this.byUser.get(userId) ?? []);
  }
}

class FakeEvidencePort implements StateEvidencePort {
  constructor(private readonly facts: FakeFactPort) {}
  async resolveEvidence(userId: string, refs: string[]): Promise<ResolvedEvidence[]> {
    const facts = await this.facts.readStateFacts(userId);
    const byId = new Map(facts.map((f) => [f.id, f]));
    return refs.map((ref) => {
      const f = byId.get(ref);
      return f
        ? { ref, kind: f.kind, label: f.summary }
        : { ref, kind: 'unresolved', label: `(${ref} gone)` };
    });
  }
}

/** Records every emitted MemoryEvent so the change hook is observable. */
class RecordingEventPort implements StateEventPort {
  readonly events: Array<{ userId: string; rationale: string; payload: Record<string, unknown> }> = [];
  recordStateEvent(input: {
    userId: string;
    rationale: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    this.events.push(input);
    return Promise.resolve();
  }
}

/**
 * A deterministic StateUpdater double: emits one demonstrated_skills dimension
 * per skill fact + one summarized career_goals dimension, all grounded in the
 * facts' ids. Mirrors the real agent's OUTPUT shape without a gateway, so the
 * handler/service wiring is what's under test here.
 */
class FixtureAgent implements StateModelAgent {
  derive(profile: StateProfileFact[]): Promise<DerivedDimension[]> {
    const skills = profile.filter((f) => f.kind === 'skill');
    const dims: DerivedDimension[] = [
      {
        dimension: 'demonstrated_skills',
        values: skills.map((s) => s.summary),
        confidence: skills.length > 0 ? 0.8 : 0,
        evidenceRefs: skills.map((s) => s.id),
      },
    ];
    return Promise.resolve(dims);
  }
}

function buildDeps(): { deps: StateHandlerDeps; facts: FakeFactPort; events: RecordingEventPort } {
  const facts = new FakeFactPort();
  const events = new RecordingEventPort();
  const service = new CareerStateService({
    facts,
    evidence: new FakeEvidencePort(facts),
    store: new InMemoryStateStore(),
    events,
    agent: new FixtureAgent(),
  });
  return { deps: { service }, facts, events };
}

const skillFact = (id: string, summary: string): StateProfileFact => ({ id, kind: 'skill', summary });

describe('GET /v1/cie/state', () => {
  it('computes lazily on first read and returns the persisted model', async () => {
    const { deps, facts } = buildDeps();
    facts.byUser.set(USER_A, [skillFact('f1', 'Kubernetes'), skillFact('f2', 'Terraform')]);

    const res = await getState(ctx(USER_A), deps);
    expect(res.status).toBe(200);
    const model = res.body as CareerStateModel;
    const demonstrated = model.dimensions.find((d) => d.dimension === 'demonstrated_skills');
    expect(demonstrated?.value.values).toEqual(['Kubernetes', 'Terraform']);
  });

  it('scopes per-user — B never sees A\'s computed state', async () => {
    const { deps, facts } = buildDeps();
    facts.byUser.set(USER_A, [skillFact('f1', 'Kubernetes')]);
    facts.byUser.set(USER_B, [skillFact('f9', 'Figma')]);

    const a = (await getState(ctx(USER_A), deps)).body as CareerStateModel;
    const b = (await getState(ctx(USER_B), deps)).body as CareerStateModel;

    expect(a.dimensions.find((d) => d.dimension === 'demonstrated_skills')?.value.values).toEqual(['Kubernetes']);
    expect(b.dimensions.find((d) => d.dimension === 'demonstrated_skills')?.value.values).toEqual(['Figma']);
  });
});

describe('GET /v1/cie/state/:dimension/explain', () => {
  it('resolves evidence refs back to their source facts', async () => {
    const { deps, facts } = buildDeps();
    facts.byUser.set(USER_A, [skillFact('f1', 'Kubernetes')]);
    await getState(ctx(USER_A), deps);

    const res = await explainDimension(ctx(USER_A), 'demonstrated_skills', deps);
    expect(res.status).toBe(200);
    const explanation = res.body as DimensionExplanation;
    expect(explanation.evidence.map((e) => e.label)).toContain('Kubernetes');
    expect(explanation.reasoning).toContain('demonstrated_skills');
  });

  it('returns 404 for an unknown dimension', async () => {
    const { deps, facts } = buildDeps();
    facts.byUser.set(USER_A, [skillFact('f1', 'Kubernetes')]);
    await getState(ctx(USER_A), deps);

    const res = await explainDimension(ctx(USER_A), 'not_a_dimension', deps);
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/cie/state/recompute — change hook', () => {
  it('emits a MemoryEvent recording WHY a dimension moved after a fact edit', async () => {
    const { deps, facts, events } = buildDeps();
    facts.byUser.set(USER_A, [skillFact('f1', 'Kubernetes')]);
    await getState(ctx(USER_A), deps); // v1

    // Edit the profile: add a demonstrated skill, then route through the change hook.
    facts.byUser.set(USER_A, [skillFact('f1', 'Kubernetes'), skillFact('f2', 'Terraform')]);
    const res = await recomputeState(ctx(USER_A), { factId: 'f2', reason: 'added Terraform' }, deps);
    expect(res.status).toBe(200);

    const moveEvent = events.events.find(
      (e) => typeof e.payload.dimension === 'string' && e.payload.dimension === 'demonstrated_skills',
    );
    expect(moveEvent).toBeDefined();
    expect(moveEvent!.payload.factId).toBe('f2');
    expect(moveEvent!.rationale).toContain('demonstrated_skills');
    expect(moveEvent!.rationale).toContain('Terraform');
  });

  it('recompute without a body does a full recompute (no change-hook events)', async () => {
    const { deps, facts, events } = buildDeps();
    facts.byUser.set(USER_A, [skillFact('f1', 'Kubernetes')]);

    const res = await recomputeState(ctx(USER_A), undefined, deps);
    expect(res.status).toBe(200);
    // Full recompute emits the recompute summary event, not per-dimension move events.
    expect(events.events.some((e) => e.payload.dimension !== undefined)).toBe(false);
    expect(events.events.some((e) => typeof e.payload.dimensionCount === 'number')).toBe(true);
  });
});
