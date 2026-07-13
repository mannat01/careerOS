/**
 * CareerStateService — the application service that owns the Career State Model
 * lifecycle: compute → persist → explain → recompute-on-change.
 *
 * It depends on NARROW PORTS, never on @careeros/db or even MemoryService
 * directly, so it stays a pure, unit-testable orchestrator:
 *   - `StateFactPort`  — reads a user's structured profile facts (backed in the
 *     app by MemoryService's ProfileReader).
 *   - `StateEvidencePort` — resolves an evidence ref to a human-readable source
 *     (a profile fact or a graph node) for the /explain endpoint.
 *   - `StateStore` — persists/reads the CareerStateModel rows (Prisma in prod,
 *     in-memory in tests).
 *   - `StateEventPort` — records a MemoryEvent capturing WHY a dimension moved
 *     (backed by MemoryService.recordEvent).
 *   - `StateModelAgent` — the StateUpdater (LLM + deterministic guardrails).
 *
 * The change hook (`recomputeForFactChange`) is the M02 requirement: editing a
 * profile fact recomputes the affected dimensions and emits a MemoryEvent that
 * records the before/after so history explains the movement.
 */
import type { StateModelAgent } from './agent.js';
import {
  MODEL_VERSION,
  type CareerStateDimension,
  type CareerStateModel,
  type DerivedDimension,
  type DimensionKey,
  type StateProfileFact,
} from './model.js';

// ---------- ports ----------

/** Reads a user's structured profile facts (app-side adapter wraps MemoryService). */
export interface StateFactPort {
  readStateFacts(userId: string): Promise<StateProfileFact[]>;
}

/** One resolved evidence source, for the /explain endpoint. */
export interface ResolvedEvidence {
  ref: string;
  kind: string;
  label: string;
}

/** Resolves an evidence ref → its source (profile fact / graph node). */
export interface StateEvidencePort {
  resolveEvidence(userId: string, refs: string[]): Promise<ResolvedEvidence[]>;
}

/** Persistence port for the CareerStateModel (Prisma in prod, in-memory in tests). */
export interface StateStore {
  load(userId: string): Promise<CareerStateModel | null>;
  save(model: CareerStateModel): Promise<CareerStateModel>;
}

/** Records a MemoryEvent capturing WHY a dimension moved. */
export interface StateEventPort {
  recordStateEvent(input: {
    userId: string;
    rationale: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

export interface CareerStateServiceDeps {
  facts: StateFactPort;
  evidence: StateEvidencePort;
  store: StateStore;
  events: StateEventPort;
  agent: StateModelAgent;
}

// ---------- explain result ----------

export interface DimensionExplanation {
  dimension: string;
  values: string[];
  confidence: number;
  provenance: string;
  /** The reasoning summary + the resolved evidence sources. */
  reasoning: string;
  evidence: ResolvedEvidence[];
}

// ---------- service ----------

export class CareerStateService {
  constructor(private readonly deps: CareerStateServiceDeps) {}

  /** Read the persisted state model for a user (null when never computed). */
  async getState(userId: string): Promise<CareerStateModel | null> {
    return this.deps.store.load(userId);
  }

  /**
   * Compute (or recompute) the FULL state model from current profile facts and
   * persist it, bumping the version. Idempotent given identical facts.
   */
  async recompute(userId: string, profileId: string): Promise<CareerStateModel> {
    const facts = await this.deps.facts.readStateFacts(userId);
    const derived = await this.deps.agent.derive(facts);
    const prior = await this.deps.store.load(userId);
    const model = toModel(profileId, (prior?.version ?? 0) + 1, derived);
    const saved = await this.deps.store.save(model);

    await this.deps.events.recordStateEvent({
      userId,
      rationale: `Career state recomputed (v${saved.version}) from ${facts.length} profile facts.`,
      payload: { profileId, version: saved.version, dimensionCount: saved.dimensions.length },
    });
    return saved;
  }

  /**
   * CHANGE HOOK: a profile fact was edited/added/removed. Recompute the whole
   * model, then emit a MemoryEvent per dimension whose value or confidence
   * MOVED, recording the before → after so history explains WHY it changed.
   */
  async recomputeForFactChange(
    userId: string,
    profileId: string,
    change: { factId: string; reason: string },
  ): Promise<CareerStateModel> {
    const before = await this.deps.store.load(userId);
    const facts = await this.deps.facts.readStateFacts(userId);
    const derived = await this.deps.agent.derive(facts);
    const model = toModel(profileId, (before?.version ?? 0) + 1, derived);
    const saved = await this.deps.store.save(model);

    const moved = diffDimensions(before?.dimensions ?? [], saved.dimensions);
    for (const m of moved) {
      await this.deps.events.recordStateEvent({
        userId,
        rationale:
          `Dimension "${m.dimension}" moved after editing fact ${change.factId} (${change.reason}): ` +
          `${describe(m.before)} → ${describe(m.after)}.`,
        payload: {
          profileId,
          version: saved.version,
          dimension: m.dimension,
          factId: change.factId,
          before: m.before,
          after: m.after,
        },
      });
    }
    return saved;
  }

  /**
   * Explain ONE dimension: its values, confidence, provenance, a reasoning
   * sentence, and the RESOLVED evidence sources (each ref → a fact/node label).
   */
  async explainDimension(userId: string, dimension: string): Promise<DimensionExplanation | null> {
    const model = await this.deps.store.load(userId);
    const dim = model?.dimensions.find((d) => d.dimension === dimension);
    if (!dim) return null;

    const evidence = await this.deps.evidence.resolveEvidence(userId, dim.evidenceRefs);
    return {
      dimension: dim.dimension,
      values: dim.value.values,
      confidence: dim.confidence,
      provenance: dim.provenance,
      reasoning:
        dim.value.values.length === 0
          ? `No signal in the profile supports "${dim.dimension}"; left empty by design.`
          : `Derived "${dim.dimension}" = [${dim.value.values.join(', ')}] at confidence ${dim.confidence.toFixed(
              2,
            )}, grounded in ${evidence.length} evidence source(s).`,
      evidence,
    };
  }
}

// ---------- pure helpers ----------

/** Build a persisted model from derived dimensions (adds provenance + freshness). */
export function toModel(
  profileId: string,
  version: number,
  derived: DerivedDimension[],
): CareerStateModel {
  const now = new Date().toISOString();
  const dimensions: CareerStateDimension[] = derived.map((d) => ({
    dimension: d.dimension as DimensionKey,
    value: { values: d.values },
    confidence: d.confidence,
    provenance: provenanceLabel(d),
    evidenceRefs: d.evidenceRefs,
    freshnessAt: now,
    modelVersion: MODEL_VERSION,
  }));
  return { profileId, version, updatedAt: now, dimensions };
}

function provenanceLabel(d: DerivedDimension): string {
  if (d.values.length === 0) return 'no-signal';
  if (d.dimension === 'demonstrated_skills') return 'demonstrated';
  if (d.dimension === 'inferred_skills') return 'inferred';
  return 'summarized';
}

interface DimensionMove {
  dimension: string;
  before: DerivedDimension | null;
  after: DerivedDimension | null;
}

/** Dimensions whose values or confidence changed between two model versions. */
export function diffDimensions(
  before: CareerStateDimension[],
  after: CareerStateDimension[],
): DimensionMove[] {
  const keys = new Set<string>([...before, ...after].map((d) => d.dimension));
  const moves: DimensionMove[] = [];
  for (const key of keys) {
    const b = before.find((d) => d.dimension === key);
    const a = after.find((d) => d.dimension === key);
    const bd = b ? toDerivedLite(b) : null;
    const ad = a ? toDerivedLite(a) : null;
    if (!sameDimension(bd, ad)) moves.push({ dimension: key, before: bd, after: ad });
  }
  return moves;
}

function toDerivedLite(d: CareerStateDimension): DerivedDimension {
  return {
    dimension: d.dimension,
    values: d.value.values,
    confidence: d.confidence,
    evidenceRefs: d.evidenceRefs,
  };
}

function sameDimension(a: DerivedDimension | null, b: DerivedDimension | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.values.join('|') === b.values.join('|') &&
    Math.abs(a.confidence - b.confidence) < 1e-9 &&
    a.evidenceRefs.join('|') === b.evidenceRefs.join('|')
  );
}

function describe(d: DerivedDimension | null): string {
  if (d === null || d.values.length === 0) return '(empty)';
  return `[${d.values.join(', ')}]@${d.confidence.toFixed(2)}`;
}
