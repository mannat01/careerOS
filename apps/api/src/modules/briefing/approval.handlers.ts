/**
 * M07 — approval queue for BriefingItems.
 *
 * Endpoints (mounted under /v1/briefings/:id/items/:itemId/…):
 *
 *   POST /approve  — user consents to a Yellow (or Green) item. For Yellow this
 *                    MINTS a single-use ApprovalToken bound to
 *                    (user, `briefing.item.execute`, payloadHash) with a
 *                    conservative TTL, and transitions the item to `approved`.
 *                    The caller redeems the token via the capability-gate to
 *                    actually execute the side effect; the token itself will
 *                    NEVER unlock a Red action (gate hard-denies Red).
 *
 *   POST /edit     — user replaces the item's payload before approving. The
 *                    new payloadHash invalidates any prior token minted for
 *                    this item. Transition → `edited`.
 *
 *   POST /skip     — user dismisses the item. No token is minted. Transition
 *                    → `skipped`. Any prior token is orphaned (dies at TTL).
 *
 * Every transition:
 *   - is PER-USER scoped (a mismatch → 404, never 403 — we do not leak ids);
 *   - is idempotent w.r.t. terminal states (`approved`/`edited`/`skipped` may
 *     only leave `proposed` — retrying is a validation_failed);
 *   - writes an immutable audit row with the trace id.
 *
 * NOTE: this file does NOT execute Yellow side effects. Execution goes
 * through the capability-gate + the concrete action's tool handler, and only
 * with the token minted here. This preserves the "prompt is never the
 * control" invariant.
 */
import type { AuditClient } from '@careeros/observability';
import {
  hashPayload,
  mintApprovalToken,
  type ApprovalTokenStore,
} from '@careeros/capability-gate';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';
import type { BriefingItem, BriefingItemState, BriefingStorePort } from './briefing.handlers.js';

/**
 * The gate action minted-under for approved BriefingItems. This is the ONE
 * action the resulting token can unlock; a token minted here can never open
 * `draft.send` or any other action (`wrong_action` at verify).
 */
export const BRIEFING_ITEM_EXECUTE_ACTION = 'briefing.item.execute' as const;

/**
 * Conservative default TTL for approval tokens: 15 minutes. Short enough that
 * a stolen token is quickly useless; long enough for a normal user redemption.
 * Overridable via deps for tests / product tuning.
 */
export const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000;

export interface ApprovalHandlerDeps {
  store: BriefingStorePort;
  tokenStore: ApprovalTokenStore;
  audit: AuditClient;
  /** HMAC secret shared with the capability-gate. */
  approvalSecret: string;
  approvalTtlMs?: number;
  clock?: () => Date;
}

interface ApprovalOkBody {
  item: BriefingItem;
  /** Present ONLY when the approval minted a token (Yellow items). */
  approvalToken?: string;
  approvalTokenExpiresAt?: string;
}

// ---------- utility ----------

function nowMs(deps: ApprovalHandlerDeps): number {
  return (deps.clock ?? (() => new Date()))().getTime();
}

/**
 * Load an item that BELONGS TO the caller's run. Returns null (surfaced as
 * 404 upstream) for any mismatch — cross-user id, wrong run, or missing item.
 * We rely on the store's optional helper; when absent (e.g. an in-memory
 * fake in an older test) we degrade gracefully via getById.
 */
async function loadItemForCaller(
  ctx: RequestContext,
  runId: string,
  itemId: string,
  deps: ApprovalHandlerDeps,
): Promise<BriefingItem | null> {
  if (deps.store.findItemOnUserRun) {
    return deps.store.findItemOnUserRun(ctx.userId, runId, itemId);
  }
  const run = await deps.store.getById(ctx.userId, runId);
  if (!run) return null;
  return run.items.find((i) => i.id === itemId) ?? null;
}

async function transitionItem(
  itemId: string,
  input: { state: BriefingItemState; payload?: Record<string, unknown> },
  deps: ApprovalHandlerDeps,
): Promise<BriefingItem> {
  if (!deps.store.updateItemState) {
    throw new Error('BriefingStorePort.updateItemState is required for the approval queue');
  }
  return deps.store.updateItemState(itemId, input);
}

// ---------- POST /v1/briefings/:id/items/:itemId/approve ----------

/**
 * Approve a BriefingItem. Green items are approved as a Green audit signal
 * (no token needed — the user is affirming; the gate would allow execution
 * anyway). Yellow items ALSO mint a single-use ApprovalToken bound to
 * (user, `briefing.item.execute`, payloadHash) so a follow-up call can
 * execute exactly this item's action exactly once.
 *
 * Red items are refused at this endpoint: Red is never automated, and no
 * token can enable a Red action; approving would be meaningless.
 */
export async function approveBriefingItem(
  ctx: RequestContext,
  runId: string,
  itemId: string,
  deps: ApprovalHandlerDeps,
): Promise<HandlerResponse<ApprovalOkBody>> {
  const item = await loadItemForCaller(ctx, runId, itemId, deps);
  if (!item) {
    return errorResponse('not_found', 'Briefing item not found.', {
      details: { runId, itemId },
      traceId: ctx.traceId,
    });
  }
  if (item.state !== 'proposed') {
    return errorResponse('validation_failed', `Item is already ${item.state}.`, {
      details: { state: item.state },
      traceId: ctx.traceId,
    });
  }
  if (item.autonomyTier === 'red') {
    // Refuse at the boundary — Red items must NEVER graduate through approval.
    await deps.audit.append({
      userId: ctx.userId,
      actor: 'user',
      action: 'briefing.item.approve_denied',
      target: item.id,
      reason: 'Red items cannot be approved for execution',
      traceId: ctx.traceId,
    });
    return errorResponse('capability_denied', 'Red items cannot be approved for execution.', {
      details: { itemId, tier: 'red' },
      traceId: ctx.traceId,
    });
  }

  const updated = await transitionItem(item.id, { state: 'approved' }, deps);

  const body: ApprovalOkBody = { item: updated };

  if (item.autonomyTier === 'yellow') {
    // Mint a token bound to the EXACT payload the user consented to. Any
    // subsequent /edit changes the payloadHash and invalidates this token.
    const ttlMs = deps.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
    const expiresAtMs = nowMs(deps) + ttlMs;
    const token = await mintApprovalToken({
      userId: ctx.userId,
      action: BRIEFING_ITEM_EXECUTE_ACTION,
      payload: updated.payload,
      ttlMs,
      secret: deps.approvalSecret,
      store: deps.tokenStore,
      now: () => nowMs(deps),
    });
    body.approvalToken = token;
    body.approvalTokenExpiresAt = new Date(expiresAtMs).toISOString();
  }

  await deps.audit.append({
    userId: ctx.userId,
    actor: 'user',
    action: 'briefing.item.approve',
    target: updated.id,
    reason:
      item.autonomyTier === 'yellow'
        ? 'Yellow item approved — single-use token minted'
        : 'Green item approved',
    traceId: ctx.traceId,
  });

  return ok(body);
}

// ---------- POST /v1/briefings/:id/items/:itemId/edit ----------

/**
 * Edit a BriefingItem's payload before approval. The item stays in a
 * post-`proposed` terminal state (`edited`) but must be re-approved to mint
 * a token — the new payloadHash makes any prior token unusable (the gate's
 * `payload_mismatch` verdict).
 *
 * The body is a fully replaced `payload` object; the store persists it as-is.
 */
export async function editBriefingItem(
  ctx: RequestContext,
  runId: string,
  itemId: string,
  body: unknown,
  deps: ApprovalHandlerDeps,
): Promise<HandlerResponse<{ item: BriefingItem }>> {
  const item = await loadItemForCaller(ctx, runId, itemId, deps);
  if (!item) {
    return errorResponse('not_found', 'Briefing item not found.', {
      details: { runId, itemId },
      traceId: ctx.traceId,
    });
  }
  if (item.state !== 'proposed') {
    return errorResponse('validation_failed', `Item is already ${item.state}.`, {
      details: { state: item.state },
      traceId: ctx.traceId,
    });
  }
  if (item.autonomyTier === 'red') {
    return errorResponse('capability_denied', 'Red items cannot be edited for execution.', {
      details: { itemId, tier: 'red' },
      traceId: ctx.traceId,
    });
  }

  const payload = coercePayload(body);
  if (!payload) {
    return errorResponse('validation_failed', 'Expected {"payload": {...}}.', {
      traceId: ctx.traceId,
    });
  }

  const updated = await transitionItem(item.id, { state: 'edited', payload }, deps);

  await deps.audit.append({
    userId: ctx.userId,
    actor: 'user',
    action: 'briefing.item.edit',
    target: updated.id,
    reason: `Payload edited (new hash=${hashPayload(payload).slice(0, 12)}…)`,
    traceId: ctx.traceId,
  });

  return ok({ item: updated });
}

// ---------- POST /v1/briefings/:id/items/:itemId/skip ----------

/**
 * Skip (dismiss) a BriefingItem. No token minted; any prior token is
 * orphaned and will die at TTL. This is the "no, thanks" path that the
 * milestone-01 tiering guarantees.
 */
export async function skipBriefingItem(
  ctx: RequestContext,
  runId: string,
  itemId: string,
  deps: ApprovalHandlerDeps,
): Promise<HandlerResponse<{ item: BriefingItem }>> {
  const item = await loadItemForCaller(ctx, runId, itemId, deps);
  if (!item) {
    return errorResponse('not_found', 'Briefing item not found.', {
      details: { runId, itemId },
      traceId: ctx.traceId,
    });
  }
  if (item.state !== 'proposed') {
    return errorResponse('validation_failed', `Item is already ${item.state}.`, {
      details: { state: item.state },
      traceId: ctx.traceId,
    });
  }

  const updated = await transitionItem(item.id, { state: 'skipped' }, deps);

  await deps.audit.append({
    userId: ctx.userId,
    actor: 'user',
    action: 'briefing.item.skip',
    target: updated.id,
    reason: 'User skipped item',
    traceId: ctx.traceId,
  });

  return ok({ item: updated });
}

// ---------- internal parsing ----------

function coercePayload(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const payload = b.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}