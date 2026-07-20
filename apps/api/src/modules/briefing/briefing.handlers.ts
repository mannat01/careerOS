/**
 * M05 Stage-5 Step-5 — the manual Briefing (closes Stage 5).
 *
 * The BriefingView UI is deferred to the web-app effort; this module is
 * orchestration + persistence + audit. `runManualBriefing` composes a briefing
 * per docs/milestone-05.md §8 spirit: pull scored opportunities (discovery +
 * match), identify gaps (per-opportunity + aggregate via the state model), and
 * a strategic "what to focus on" summary via the StrategicReasoner.
 *
 * Discipline (docs/milestone-05.md §Acceptance criteria):
 *   - **Idempotent + resilient**: a failing step (e.g. a source or gap step)
 *     yields a PARTIAL briefing with that step flagged + retryable — NEVER a
 *     blank/failed whole. Each step is wrapped in a try/catch; the run keeps
 *     going and its status becomes `partial`. On every step failing, the run is
 *     `failed` but the record + step trace still persist.
 *   - **Everything advisory / Green**: BriefingItems are `proposed`
 *     (opportunity | gap | focus | suggestion). Nothing acts; a Yellow item is
 *     surfaced as `proposed`, never executed.
 *   - **Per-user by construction**: userId flows from the verified
 *     RequestContext; reads/writes are scoped by userId.
 *   - **Audit backbone**: each step records status + cost + trace id on the
 *     BriefingRun; the full run is also mirrored to the AuditLog.
 */
import { randomUUID } from 'node:crypto';
import type { AuditClient } from '@careeros/observability';
import type {
  DecisionContract,
  ReasonerOpportunity,
  StrategicReasonerService,
} from '@careeros/cie-reasoning';
import { STRATEGIC_REASONER_MODEL_VERSION } from '@careeros/cie-reasoning';
import type { MatchScorerService, MatchScore } from '@careeros/cie-resume';
import { MATCH_SCORER_MODEL_VERSION } from '@careeros/cie-resume';
import type { CareerStateService } from '@careeros/cie-state';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';
import type { OpportunityDetail, OpportunityReadPort } from '../opportunity/opportunity.handlers.js';
import { opportunityToJob } from '../opportunity/opportunity.handlers.js';
import type { ProfileResolver } from '../opportunity/opportunity.handlers.js';

// ---------- domain shapes (mirrored by contracts) ----------

export type BriefingTrigger = 'scheduled' | 'manual';
export type BriefingRunStatus = 'queued' | 'running' | 'partial' | 'complete' | 'failed';
export type BriefingItemKind =
  | 'opportunity'
  | 'tailored_resume'
  | 'draft'
  | 'prep'
  | 'gap'
  | 'note'
  | 'focus'
  | 'suggestion';
export type BriefingItemState = 'proposed' | 'approved' | 'edited' | 'skipped' | 'failed';

/** One step's audit record on a BriefingRun. `error` populated on failure. */
export interface BriefingStepRecord {
  name: string;
  status: 'ok' | 'failed' | 'skipped';
  costUsd: number;
  traceId: string;
  startedAt: string;
  finishedAt: string;
  itemsProduced: number;
  error?: string;
  /** Retry hint on failure — true means the step can be safely retried. */
  retryable?: boolean;
}

export interface BriefingItem {
  id: string;
  kind: BriefingItemKind;
  refId: string | null;
  autonomyTier: 'green' | 'yellow' | 'red';
  state: BriefingItemState;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface BriefingRun {
  id: string;
  userId: string;
  trigger: BriefingTrigger;
  status: BriefingRunStatus;
  inputs: Record<string, unknown>;
  steps: BriefingStepRecord[];
  costTotal: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface BriefingRunDetail extends BriefingRun {
  items: BriefingItem[];
}

// ---------- ports ----------

/**
 * Persistence port for BriefingRun + BriefingItem. Prisma adapter lives in
 * @careeros/db (structural typing keeps @careeros/db free of a dependency on
 * apps/api). PER-USER scoped: `getById(userId, id)` returns null when the run
 * is owned by someone else.
 */
export interface BriefingStorePort {
  createRun(input: {
    userId: string;
    trigger: BriefingTrigger;
    inputs: Record<string, unknown>;
  }): Promise<BriefingRun>;
  finalizeRun(
    runId: string,
    input: {
      status: BriefingRunStatus;
      steps: BriefingStepRecord[];
      costTotal: number;
      finishedAt: string;
    },
  ): Promise<BriefingRun>;
  addItems(runId: string, items: Omit<BriefingItem, 'id' | 'createdAt'>[]): Promise<BriefingItem[]>;
  getById(userId: string, id: string): Promise<BriefingRunDetail | null>;
  latestForUser(userId: string): Promise<BriefingRunDetail | null>;
  /**
   * M07 approval-queue — find one item on a run scoped by the caller. Returns
   * `null` if the run does not belong to `userId` OR the item is not on it.
   * Used by approve/edit/skip to enforce per-user scoping without leaking ids.
   */
  findItemOnUserRun?(
    userId: string,
    runId: string,
    itemId: string,
  ): Promise<BriefingItem | null>;
  /**
   * M07 approval-queue — transition a single BriefingItem's `state` (and
   * optionally mutate its `payload` for `edit`). Returns the updated item.
   * Callers MUST have already verified per-user scope + capability-gate.
   */
  updateItemState?(
    itemId: string,
    input: { state: BriefingItemState; payload?: Record<string, unknown> },
  ): Promise<BriefingItem>;
}

/**
 * INJECTABLE step-execution hooks — the e2e/unit tests use these to make one
 * step fail deterministically without stubbing the whole service. Prod leaves
 * them undefined; the orchestrator runs the real step then.
 */
export interface BriefingStepOverrides {
  scoredOpportunities?: () => Promise<void>;
  gaps?: () => Promise<void>;
  focus?: () => Promise<void>;
}

export interface BriefingHandlerDeps {
  store: BriefingStorePort;
  opportunities: OpportunityReadPort;
  profiles: ProfileResolver;
  scorer: MatchScorerService;
  reasoner: StrategicReasonerService;
  state: CareerStateService;
  audit: AuditClient;
  /** Top-N scored opportunities to consider. Default 5. */
  topN?: number;
  /** Test-only injection to force step failures — see BriefingStepOverrides. */
  overrides?: BriefingStepOverrides;
}

// ---------- POST /v1/briefings/run ----------

/**
 * Orchestrate one manual briefing. Never throws to the caller — a failing step
 * yields a partial briefing (or `failed` if every step fails), and the record
 * always persists. Advisory Green throughout: items are `proposed`, nothing
 * acts. Yellow items are surfaced as `proposed` (never executed).
 */
export async function runManualBriefing(
  ctx: RequestContext,
  body: unknown,
  deps: BriefingHandlerDeps,
): Promise<HandlerResponse<BriefingRunDetail>> {
  const parsed = parseRunBody(body);
  if (!parsed) {
    return errorResponse('validation_failed', 'Expected {"trigger":"manual"}.', {
      traceId: ctx.traceId,
    });
  }

  const topN = deps.topN ?? 5;
  const run = await deps.store.createRun({
    userId: ctx.userId,
    trigger: 'manual',
    inputs: { topN },
  });

  const steps: BriefingStepRecord[] = [];
  const items: Omit<BriefingItem, 'id' | 'createdAt'>[] = [];
  let costTotal = 0;

  // ---- step 1: scored opportunities (discovery + match) ----
  const scoredResult = await runStep('scored_opportunities', async () => {
    if (deps.overrides?.scoredOpportunities) {
      await deps.overrides.scoredOpportunities();
    }
    const profileId = await deps.profiles.resolveProfileId(ctx.userId);
    if (!profileId) {
      // No profile yet — a legitimate "no signal" outcome, not a failure.
      return { produced: 0, cost: 0, scored: [] as ScoredOpportunity[] };
    }
    const page = await deps.opportunities.list({}, { limit: topN * 2 });
    const scored: ScoredOpportunity[] = [];
    let cost = 0;
    for (const listItem of page.data) {
      const detail = await deps.opportunities.getById(listItem.id);
      if (!detail) continue;
      const job = opportunityToJob(detail);
      const score = await deps.scorer.scoreJob(ctx.userId, job);
      cost += estimateScorerCost();
      scored.push({ detail, score });
    }
    // Top-N by overall.
    scored.sort((a, b) => b.score.overall - a.score.overall);
    const top = scored.slice(0, topN);
    for (const s of top) {
      items.push({
        kind: 'opportunity',
        refId: s.detail.id,
        autonomyTier: 'green',
        state: 'proposed',
        payload: {
          company: s.detail.company,
          role: s.detail.role,
          location: s.detail.location,
          remote: s.detail.remote,
          score: s.score.overall,
          explanation: s.score.explanation,
          evidenceRefs: s.score.evidenceRefs,
          modelVersion: MATCH_SCORER_MODEL_VERSION,
        },
      });
    }
    return { produced: top.length, cost, scored: top };
  });
  const scored = scoredResult.ok ? scoredResult.value.scored : [];
  steps.push(scoredResult.step);
  costTotal += scoredResult.step.costUsd;

  // ---- step 2: per-opportunity + aggregate gaps (via subscores + state model) ----
  const gapsResult = await runStep('gaps', async () => {
    if (deps.overrides?.gaps) {
      await deps.overrides.gaps();
    }
    let produced = 0;
    // Per-opportunity gaps: any subscore < 60 is a gap named by its dimension.
    for (const s of scored) {
      const weakSubs = s.score.subscores.filter((sub) => sub.value < 60);
      for (const sub of weakSubs) {
        items.push({
          kind: 'gap',
          refId: s.detail.id,
          autonomyTier: 'green',
          state: 'proposed',
          payload: {
            scope: 'per_opportunity',
            opportunity: `${s.detail.company} — ${s.detail.role}`,
            dimension: sub.key,
            score: sub.value,
            explanation: s.score.explanation,
            evidenceRefs: s.score.evidenceRefs,
          },
        });
        produced++;
      }
    }
    // Aggregate gap: dimensions on the CareerStateModel with LOW confidence
    // signal areas the user has not yet demonstrated at all — first-class
    // "no signal", never a fabricated guess (per state-model discipline).
    const stateModel = await deps.state.getState(ctx.userId);
    if (stateModel) {
      const lowConf = stateModel.dimensions.filter((d) => d.confidence < 0.4);
      for (const d of lowConf) {
        items.push({
          kind: 'gap',
          refId: null,
          autonomyTier: 'green',
          state: 'proposed',
          payload: {
            scope: 'aggregate',
            dimension: d.dimension,
            confidence: d.confidence,
            values: d.value.values,
            evidenceRefs: d.evidenceRefs,
          },
        });
        produced++;
      }
    }
    return { produced, cost: 0 };
  });
  steps.push(gapsResult.step);
  costTotal += gapsResult.step.costUsd;

  // ---- step 3: strategic "what to focus on" summary ----
  const focusResult = await runStep('focus', async () => {
    if (deps.overrides?.focus) {
      await deps.overrides.focus();
    }
    const opportunityCtx: ReasonerOpportunity | undefined =
      scored.length > 0
        ? {
            title: scored[0]!.detail.role,
            requirements: [],
            text: `Top match: ${scored[0]!.detail.company} — ${scored[0]!.detail.role}`,
          }
        : undefined;
    const contract: DecisionContract = await deps.reasoner.decide(
      ctx.userId,
      'What should I focus on this week to maximize progress on my career goals?',
      opportunityCtx,
    );
    items.push({
      kind: 'focus',
      refId: null,
      autonomyTier: 'green',
      state: 'proposed',
      payload: {
        recommendation: contract.recommendation,
        reasoning: contract.reasoning,
        confidence: contract.confidence,
        alternatives: contract.alternatives,
        assumptions: contract.assumptions,
        evidenceRefs: contract.evidenceRefs,
        optionalityNote: contract.optionalityNote,
        modelVersion: contract.modelVersion ?? STRATEGIC_REASONER_MODEL_VERSION,
      },
    });
    // Fold the reasoner's alternatives (each is itself an actionable suggestion)
    // into `suggestion` items — advisory Green; nothing acts.
    for (const alt of contract.alternatives) {
      items.push({
        kind: 'suggestion',
        refId: null,
        autonomyTier: 'green',
        state: 'proposed',
        payload: { text: alt, sourcedFrom: 'strategic_reasoner' },
      });
    }
    return { produced: 1 + contract.alternatives.length, cost: estimateReasonerCost() };
  });
  steps.push(focusResult.step);
  costTotal += focusResult.step.costUsd;

  // ---- persist items + finalize ----
  await deps.store.addItems(run.id, items);

  const okCount = steps.filter((s) => s.status === 'ok').length;
  const failedCount = steps.filter((s) => s.status === 'failed').length;
  const status: BriefingRunStatus =
    okCount === 0 ? 'failed' : failedCount === 0 ? 'complete' : 'partial';
  const finishedAt = new Date().toISOString();
  const finalized = await deps.store.finalizeRun(run.id, {
    status,
    steps,
    costTotal,
    finishedAt,
  });

  await deps.audit.append({
    userId: ctx.userId,
    actor: 'user',
    action: 'briefing.run.manual',
    target: run.id,
    reason: `Manual briefing composed: status=${status}, items=${items.length}, cost=$${costTotal.toFixed(4)}`,
    modelVersion: STRATEGIC_REASONER_MODEL_VERSION,
    traceId: ctx.traceId,
  });

  const detail = await deps.store.getById(ctx.userId, finalized.id);
  return { status: 201, body: detail ?? { ...finalized, items: [] } };
}

// ---------- GET /v1/briefings/:id ----------

export async function getBriefing(
  ctx: RequestContext,
  id: string,
  deps: BriefingHandlerDeps,
): Promise<HandlerResponse<BriefingRunDetail>> {
  const found = await deps.store.getById(ctx.userId, id);
  if (!found) {
    return errorResponse('not_found', 'Briefing not found.', { details: { id }, traceId: ctx.traceId });
  }
  return ok(found);
}

// ---------- GET /v1/briefings/latest ----------

export async function getLatestBriefing(
  ctx: RequestContext,
  deps: BriefingHandlerDeps,
): Promise<HandlerResponse<BriefingRunDetail>> {
  const found = await deps.store.latestForUser(ctx.userId);
  if (!found) {
    return errorResponse('not_found', 'No briefings yet for this user.', { traceId: ctx.traceId });
  }
  return ok(found);
}

// ---------- internals ----------

interface ScoredOpportunity {
  detail: OpportunityDetail;
  score: MatchScore;
}

interface StepResult<T> {
  ok: boolean;
  value: { produced: number; cost: number; scored: T[] };
  step: BriefingStepRecord;
}

async function runStep<T>(
  name: string,
  fn: () => Promise<{ produced: number; cost: number; scored?: T[] }>,
): Promise<StepResult<T>> {
  const traceId = randomUUID();
  const startedAt = new Date().toISOString();
  try {
    const value = await fn();
    const finishedAt = new Date().toISOString();
    return {
      ok: true,
      value: { produced: value.produced, cost: value.cost, scored: value.scored ?? [] },
      step: {
        name,
        status: 'ok',
        costUsd: value.cost,
        traceId,
        startedAt,
        finishedAt,
        itemsProduced: value.produced,
      },
    };
  } catch (err: unknown) {
    const finishedAt = new Date().toISOString();
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      value: { produced: 0, cost: 0, scored: [] },
      step: {
        name,
        status: 'failed',
        costUsd: 0,
        traceId,
        startedAt,
        finishedAt,
        itemsProduced: 0,
        error: message,
        retryable: true,
      },
    };
  }
}

function parseRunBody(body: unknown): { trigger: 'manual' } | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.trigger !== 'manual') return null;
  return { trigger: 'manual' };
}

// Cost estimation stubs — the LLM gateway carries real pricing (packages/llm-gateway);
// M05 keeps the composed briefing's per-step cost visible + non-zero so audit rows
// exercise the code path. Real per-call cost lands with the pricing catalog.
function estimateScorerCost(): number {
  return 0.0002;
}
function estimateReasonerCost(): number {
  return 0.0015;
}