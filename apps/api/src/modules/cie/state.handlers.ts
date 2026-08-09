/**
 * /v1/cie/state HTTP handlers + the app-side adapters that bind the
 * CareerStateService's narrow ports to the real MemoryService / GraphMemoryService.
 *
 * The handlers are pure DB-free functions: they take the verified RequestContext
 * (never an id from body/query) and a CareerStateService, so every read/write is
 * PER-USER scoped to the token owner. The service reaches the four-tier memory
 * ONLY through the ports below — never @careeros/db, never MemoryService's raw
 * tables — preserving the agent/service boundary the lint overlay enforces.
 */
import type { MemoryService, ProfileReader, ProfileFact as MemoryProfileFact } from '@careeros/memory';
import type {
  CareerStateModel,
  DimensionExplanation,
  ResolvedEvidence,
  StateEventPort,
  StateEvidencePort,
  StateFactPort,
  StateProfileFact,
} from '@careeros/cie-state';
import { CareerStateService } from '@careeros/cie-state';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';

// ---------- app-side port adapters (MemoryService seams) ----------

/**
 * StateFactPort ← the MemoryService ProfileReader tier. Maps a four-tier
 * ProfileFact (kind/text/ref) to the StateUpdater's input shape (id/kind/summary).
 * The fact's `ref` (e.g. "experience:<uuid>") is the STABLE evidence id the
 * dimensions cite — so an asserted value resolves straight back to its source row.
 * Reads flow through the injected ProfileReader port only — never @careeros/db.
 */
export class MemoryStateFactAdapter implements StateFactPort {
  constructor(private readonly profile: ProfileReader) {}

  async readStateFacts(userId: string): Promise<StateProfileFact[]> {
    const facts = await this.profile.readFacts(userId);
    return facts.map(
      (f: MemoryProfileFact): StateProfileFact => ({ id: f.ref, kind: f.kind, summary: f.text }),
    );
  }
}

/**
 * StateEvidencePort ← the ProfileReader tier. Resolves each cited evidence ref
 * back to a human-readable source (the profile fact's kind + summary) for the
 * /explain endpoint. A ref that no longer resolves is surfaced as `unresolved`
 * rather than dropped, so a stale citation is visible instead of silently gone.
 */
export class MemoryStateEvidenceAdapter implements StateEvidencePort {
  constructor(private readonly profile: ProfileReader) {}

  async resolveEvidence(userId: string, refs: string[]): Promise<ResolvedEvidence[]> {
    const facts = await this.profile.readFacts(userId);
    const byRef = new Map(facts.map((f: MemoryProfileFact) => [f.ref, f]));
    return refs.map((ref): ResolvedEvidence => {
      const f = byRef.get(ref);
      return f
        ? { ref, kind: f.kind, label: f.text }
        : { ref, kind: 'unresolved', label: `(evidence ${ref} no longer resolves)` };
    });
  }
}

/**
 * StateEventPort ← MemoryService.recordEvent. Every recompute / dimension move
 * appends ONE append-only episodic MemoryEvent recording WHY the state changed,
 * so the model's history is always explainable (architecture.md §6 episodic tier).
 */
export class MemoryStateEventAdapter implements StateEventPort {
  constructor(private readonly memory: MemoryService) {}

  async recordStateEvent(input: {
    userId: string;
    rationale: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.memory.recordEvent({
      userId: input.userId,
      type: 'system',
      payload: { kind: 'career_state', ...input.payload },
      rationale: input.rationale,
    });
  }
}

// ---------- handler deps ----------

export interface StateHandlerDeps {
  service: CareerStateService;
}

// ---------- GET /v1/cie/state ----------

/**
 * GET /v1/cie/state — the caller's current Career State Model. Reads never
 * create state; a missing model is an intentional typed 404.
 */
export async function getState(
  ctx: RequestContext,
  deps: StateHandlerDeps,
): Promise<HandlerResponse<CareerStateModel>> {
  try {
    const existing = await deps.service.getState(ctx.userId);
    if (existing) return ok(existing);
    return errorResponse('not_found', 'Career state not found.', { traceId: ctx.traceId });
  } catch {
    return errorResponse('internal', 'Career state dependency failed.', { traceId: ctx.traceId });
  }
}

// ---------- GET /v1/cie/state/:dimension/explain ----------

/**
 * GET /v1/cie/state/:dimension/explain — evidence + reasoning for ONE dimension.
 * 404 when the dimension isn't part of the (existing) model.
 */
export async function explainDimension(
  ctx: RequestContext,
  dimension: string,
  deps: StateHandlerDeps,
): Promise<HandlerResponse<DimensionExplanation>> {
  const existing = await deps.service.getState(ctx.userId);
  if (!existing) {
    return errorResponse('not_found', 'Career state not found.', { traceId: ctx.traceId });
  }

  const explanation = await deps.service.explainDimension(ctx.userId, dimension);
  if (!explanation) {
    return errorResponse('not_found', 'Unknown state dimension.', {
      details: { dimension },
      traceId: ctx.traceId,
    });
  }
  return ok(explanation);
}

// ---------- POST /v1/cie/state/recompute ----------

/**
 * POST /v1/cie/state/recompute — recompute the full model from current profile
 * facts and persist a new version. Optional body `{ factId, reason }` routes
 * through the CHANGE HOOK so a single edited fact emits a per-dimension
 * MemoryEvent recording WHY each affected dimension moved.
 */
export async function recomputeState(
  ctx: RequestContext,
  body: unknown,
  deps: StateHandlerDeps,
): Promise<HandlerResponse<CareerStateModel>> {
  const change = parseChange(body);
  const model = change
    ? await deps.service.recomputeForFactChange(ctx.userId, ctx.userId, change)
    : await deps.service.recompute(ctx.userId, ctx.userId);
  return ok(model);
}

/** Extract the optional change-hook payload from an untrusted body. */
function parseChange(body: unknown): { factId: string; reason: string } | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.factId !== 'string' || b.factId.length === 0) return null;
  return { factId: b.factId, reason: typeof b.reason === 'string' ? b.reason : 'profile fact edited' };
}
