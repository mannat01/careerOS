/**
 * M09 Step 3 — Skill development endpoints (Green, per-user scoped).
 *
 *   GET   /v1/skills/gaps          — recompute the caller's gap set via the
 *                                    deterministic GapAnalyzer, persist it
 *                                    (SkillGap rows per database-schema.md),
 *                                    and return it. Re-running is idempotent.
 *   GET   /v1/skills/learning      — the caller's learning items, each linked
 *                                    to a real SkillGap, with progress.
 *   PATCH /v1/skills/learning/:id  — progress tracking (status/progress).
 *
 * Integrity guardrail (deterministic, inside @careeros/cie-skills): a gap must
 * correspond to a real demanded-but-missing skill (no invented gaps); never a
 * skill the user already demonstrates; every learning item links to a real gap.
 * The handler persists ONLY what the analyzer's self-verified output contains.
 *
 * PER-USER by construction: `userId` flows from the verified RequestContext;
 * the profile-resolver maps it to the caller's own profileId, and the store
 * scopes every read/write by that profileId — cross-user ids return 404.
 *
 * DB-free: narrow ports only; Prisma adapters live in the composition root.
 */
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';
import type {
  LearningItemRowLike,
  SkillGapRowLike,
  SkillGapStorePortShape,
} from '@careeros/db';
import type { GapAnalysis } from '@careeros/cie-skills';

// ---------------- ports (adapters live in bootstrap) ----------------

/** Resolve `userId` → the caller's own `profileId`. Returns null if no profile. */
export interface SkillsProfileResolverPort {
  resolveProfileId(userId: string): Promise<string | null>;
}

/** Runs the deterministic, self-verifying GapAnalyzerService. */
export interface SkillsGapAnalyzerPort {
  analyze(userId: string): Promise<GapAnalysis>;
}

/**
 * OPTIONAL change hook — REUSES the M08 dashboard recompute port so a fresh
 * gap set re-materializes the caller's skill metrics (skill_momentum et al).
 * Best-effort: a recompute failure never fails the gaps request.
 */
export interface SkillsDashboardRecomputePort {
  recompute(userId: string): Promise<void>;
}

export interface SkillsHandlerDeps {
  store: SkillGapStorePortShape;
  profileResolver: SkillsProfileResolverPort;
  analyzer: SkillsGapAnalyzerPort;
  dashboards?: SkillsDashboardRecomputePort;
}

// ---------------- response shapes ----------------

export interface SkillGapResponse {
  id: string;
  skill: string;
  gap: string;
  severity: string;
  source: 'per_opp' | 'aggregate';
  opportunityId: string | null;
  evidenceRefs: string[];
  modelVersion: string;
  computedAt: string;
}

export interface LearningItemResponse {
  id: string;
  skillGapId: string;
  resource: Record<string, unknown>;
  status: 'suggested' | 'in_progress' | 'done';
  progress: number;
}

const LEARNING_STATUSES = new Set(['suggested', 'in_progress', 'done']);

// ---------------- handlers ----------------

/** GET /v1/skills/gaps — recompute + persist + return the caller's gap set. */
export async function getSkillGaps(
  ctx: RequestContext,
  deps: SkillsHandlerDeps,
): Promise<HandlerResponse<{ gaps: SkillGapResponse[] }>> {
  const profileId = await deps.profileResolver.resolveProfileId(ctx.userId);
  if (!profileId) return errorResponse('not_found', 'No profile.', { traceId: ctx.traceId });

  // Deterministic + self-verified: the analyzer discards anything its own
  // guardrail flags, so what we persist is integrity-clean by construction.
  const analysis = await deps.analyzer.analyze(ctx.userId);
  const itemsByGap = new Map<string, Array<{ resource: Record<string, unknown> }>>();
  for (const item of analysis.learningItems) {
    const list = itemsByGap.get(item.gapKey) ?? [];
    list.push({ resource: { ...item.resource } });
    itemsByGap.set(item.gapKey, list);
  }
  const rows = await deps.store.replaceForProfile(
    profileId,
    analysis.gaps.map((gap) => ({
      skill: gap.skill,
      gap: gap.gap,
      severity: gap.severity,
      source: gap.source,
      ...(gap.opportunityId !== undefined ? { opportunityId: gap.opportunityId } : {}),
      evidenceRefs: gap.evidenceRefs,
      modelVersion: analysis.modelVersion,
      learningItems: itemsByGap.get(gap.key) ?? [],
    })),
  );
  // Light wiring to the M08 dashboard: a fresh gap set is a change signal for
  // the skill metrics. Best-effort — never fails the caller's request.
  if (deps.dashboards) {
    try {
      await deps.dashboards.recompute(ctx.userId);
    } catch {
      /* best-effort */
    }
  }
  return ok({ gaps: rows.map(toGapResponse) });
}

/** GET /v1/skills/learning — the caller's learning items with progress. */
export async function getLearningItems(
  ctx: RequestContext,
  deps: SkillsHandlerDeps,
): Promise<HandlerResponse<{ items: LearningItemResponse[] }>> {
  const profileId = await deps.profileResolver.resolveProfileId(ctx.userId);
  if (!profileId) return errorResponse('not_found', 'No profile.', { traceId: ctx.traceId });
  const items = await deps.store.listLearningItems(profileId);
  return ok({ items: items.map(toItemResponse) });
}

/** PATCH /v1/skills/learning/:id — update progress/status on one item. */
export async function patchLearningItem(
  ctx: RequestContext,
  id: string,
  body: unknown,
  deps: SkillsHandlerDeps,
): Promise<HandlerResponse<{ item: LearningItemResponse }>> {
  const profileId = await deps.profileResolver.resolveProfileId(ctx.userId);
  if (!profileId) return errorResponse('not_found', 'No profile.', { traceId: ctx.traceId });

  const patch = parsePatch(body);
  if ('error' in patch) {
    return errorResponse('validation_failed', patch.error, { traceId: ctx.traceId });
  }
  if (patch.status === undefined && patch.progress === undefined) {
    return errorResponse('validation_failed', 'Provide status and/or progress.', {
      traceId: ctx.traceId,
    });
  }

  const updated = await deps.store.updateLearningItem(profileId, id, patch);
  if (!updated) {
    return errorResponse('not_found', 'Learning item not found.', { traceId: ctx.traceId });
  }
  return ok({ item: toItemResponse(updated) });
}

// ---------------- helpers ----------------

function parsePatch(
  body: unknown,
):
  | { status?: 'suggested' | 'in_progress' | 'done'; progress?: number }
  | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'Body must be an object.' };
  const raw = body as Record<string, unknown>;
  const out: { status?: 'suggested' | 'in_progress' | 'done'; progress?: number } = {};
  if (raw['status'] !== undefined) {
    if (typeof raw['status'] !== 'string' || !LEARNING_STATUSES.has(raw['status'])) {
      return { error: 'status must be one of suggested | in_progress | done.' };
    }
    out.status = raw['status'] as 'suggested' | 'in_progress' | 'done';
  }
  if (raw['progress'] !== undefined) {
    const p = raw['progress'];
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 100) {
      return { error: 'progress must be a number between 0 and 100.' };
    }
    out.progress = Math.round(p);
  }
  return out;
}

function toGapResponse(row: SkillGapRowLike): SkillGapResponse {
  return {
    id: row.id,
    skill: row.skill,
    gap: row.gap,
    severity: row.severity,
    source: row.source,
    opportunityId: row.opportunityId,
    evidenceRefs: row.evidenceRefs,
    modelVersion: row.modelVersion,
    computedAt: row.computedAt,
  };
}

function toItemResponse(row: LearningItemRowLike): LearningItemResponse {
  return {
    id: row.id,
    skillGapId: row.skillGapId,
    resource: row.resource,
    status: row.status,
    progress: row.progress,
  };
}