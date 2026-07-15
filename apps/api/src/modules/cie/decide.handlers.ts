/**
 * POST /v1/cie/decide — advisory Green endpoint that returns a full structured
 * DecisionContract (never a bare verdict). Per-user by construction: the userId
 * comes from the verified RequestContext; the caller never supplies an id.
 *
 * The handler is DB-free. The StrategicReasonerService reaches profile facts +
 * state dimensions ONLY through its narrow ports (`ReasonerFactPort` +
 * `ReasonerStatePort`), which this module backs with MemoryService's
 * `ProfileReader` + `CareerStateService` (never @careeros/db from the agent
 * boundary — the agentBoundary lint overlay enforces it).
 *
 * The safety story is the deterministic `groundContract` guardrail inside the
 * agent (packages/cie/reasoning): no matter what the frontier LLM proposes,
 * evidence refs, recommendation, and calibrated confidence are recomputed from
 * the caller's real profile + real state model. This is what earns the
 * "advisory Green" label — no external side effect, no fabricated verdict.
 * ACTING on the recommendation stays Yellow/Red at other endpoints; unchanged.
 */
import type { ProfileFact as MemoryProfileFact, ProfileReader } from '@careeros/memory';
import type { CareerStateService, CareerStateDimension } from '@careeros/cie-state';
import type {
  DecisionContract,
  ReasonerFactPort,
  ReasonerOpportunity,
  ReasonerProfileFact,
  ReasonerStateDimension,
  ReasonerStatePort,
  StrategicReasonerService,
} from '@careeros/cie-reasoning';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';

// ---------- app-side port adapters ----------

/**
 * ReasonerFactPort ← Memory/ProfileReader tier. Maps a four-tier ProfileFact
 * (kind/text/ref) into the reasoner's input shape (id/kind/summary) — same
 * projection ResumeFactAdapter / StateFactAdapter use.
 */
export class MemoryReasonerFactAdapter implements ReasonerFactPort {
  constructor(private readonly profile: ProfileReader) {}

  async readReasonerFacts(userId: string): Promise<ReasonerProfileFact[]> {
    const facts = await this.profile.readFacts(userId);
    return facts.map(
      (f: MemoryProfileFact): ReasonerProfileFact => ({
        id: f.ref,
        kind: toReasonerKind(f.kind),
        summary: f.text,
      }),
    );
  }
}

function toReasonerKind(kind: MemoryProfileFact['kind']): ReasonerProfileFact['kind'] {
  if (kind === 'education' || kind === 'project' || kind === 'skill') return kind;
  return 'experience';
}

/**
 * ReasonerStatePort ← CareerStateService. Projects the persisted Career State
 * Model down to the reasoner's flat dimension shape. Lazily computes the model
 * once when a fresh profile has never derived one, so the reasoner always sees
 * a well-shaped view instead of an empty array (mirrors GET /v1/cie/state).
 */
export class StateServiceReasonerAdapter implements ReasonerStatePort {
  constructor(private readonly state: CareerStateService) {}

  async readStateDimensions(userId: string): Promise<ReasonerStateDimension[]> {
    const existing = await this.state.getState(userId);
    const model = existing ?? (await this.state.recompute(userId, userId));
    return model.dimensions.map(
      (d: CareerStateDimension): ReasonerStateDimension => ({
        dimension: d.dimension,
        values: d.value.values,
        confidence: d.confidence,
        evidenceRefs: d.evidenceRefs,
      }),
    );
  }
}

// ---------- handler deps ----------

export interface DecideHandlerDeps {
  service: StrategicReasonerService;
}

// ---------- POST /v1/cie/decide ----------

/**
 * Body shape: `{ question: string, context?: { title, requirements, text, seniority? } }`.
 * The context is OPTIONAL — the reasoner also handles pure state questions
 * (no opportunity attached). Returns the full DecisionContract; never a bare
 * verdict.
 */
export async function decide(
  ctx: RequestContext,
  body: unknown,
  deps: DecideHandlerDeps,
): Promise<HandlerResponse<DecisionContract>> {
  const parsed = parseDecideBody(body);
  if (!parsed) {
    return errorResponse('validation_failed', 'Expected a decision question.', {
      details: { expected: '{ question: string, context?: { title, requirements, text, seniority? } }' },
      traceId: ctx.traceId,
    });
  }

  // Advisory Green action: derive a grounded contract from the caller's real
  // profile + state model. No external side effect; acting on it is Yellow/Red.
  const contract = await deps.service.decide(ctx.userId, parsed.question, parsed.context);
  return ok(contract);
}

function parseDecideBody(
  body: unknown,
): { question: string; context: ReasonerOpportunity | undefined } | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const question = str(b.question);
  if (!question) return null;

  const rawCtx = typeof b.context === 'object' && b.context !== null ? (b.context as Record<string, unknown>) : null;
  if (!rawCtx) return { question, context: undefined };

  const title = str(rawCtx.title) ?? 'Target role';
  const text = str(rawCtx.text) ?? str(rawCtx.description);
  if (!text) return { question, context: undefined };

  const requirements = arr(rawCtx.requirements) ?? [];
  const seniority = str(rawCtx.seniority);
  const context: ReasonerOpportunity = { title, seniority, requirements, text };
  return { question, context };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function arr(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
  return out.length > 0 ? out : undefined;
}
