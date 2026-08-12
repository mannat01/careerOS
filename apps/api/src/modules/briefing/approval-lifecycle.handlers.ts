/** Canonical FM5.1-pre approval lifecycle over caller-owned BriefingItems. */
import type { AuditClient } from '@careeros/observability';
import {
  approvalDenyRequestSchema,
  approvalExecuteRequestSchema,
  approvalMintRequestSchema,
  type ApprovalDenyResponse,
  type ApprovalEditResponse,
  type ApprovalExecuteResponse,
  type ApprovalMintResponse,
  type PendingApproval,
  type PendingApprovalListResponse,
} from '@careeros/contracts';
import {
  enforce,
  hashPayload,
  mintApprovalToken,
  type ApprovalTokenStore,
  type DenyReason,
} from '@careeros/capability-gate';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';
import type { BriefingItem, BriefingItemState, BriefingStorePort } from './briefing.handlers.js';

export const DEFAULT_APPROVAL_LIFECYCLE_TTL_MS = 15 * 60 * 1000;

export interface ApprovalActionExecutor {
  execute(input: {
    userId: string;
    approvalId: string;
    action: string;
    payload: Record<string, unknown>;
  }): Promise<{ outcome: string }>;
}

export interface ApprovalLifecycleHandlerDeps {
  store: BriefingStorePort;
  tokenStore: ApprovalTokenStore;
  audit: AuditClient;
  approvalSecret: string;
  executor: ApprovalActionExecutor;
  approvalTtlMs?: number;
  clock?: () => Date;
}

function now(deps: ApprovalLifecycleHandlerDeps): Date {
  return (deps.clock ?? (() => new Date()))();
}

function notFound(ctx: RequestContext, approvalId: string): HandlerResponse<never> {
  return errorResponse('not_found', 'Approval not found.', {
    details: { approvalId },
    traceId: ctx.traceId,
  });
}

function invalid(
  ctx: RequestContext,
  message: string,
  details?: Record<string, unknown>,
): HandlerResponse<never> {
  return errorResponse('validation_failed', message, { details, traceId: ctx.traceId });
}

function publicGateReason(reason: DenyReason): string {
  switch (reason) {
    case 'approval_already_consumed':
      return 'token_consumed';
    case 'approval_expired':
      return 'token_expired';
    case 'approval_payload_mismatch':
      return 'payload_mismatch';
    default:
      return reason;
  }
}

function pendingFromItem(item: BriefingItem): PendingApproval {
  if (item.autonomyTier !== 'yellow') throw new Error(`Approval ${item.id} is not Yellow.`);
  if (item.state !== 'proposed' && item.state !== 'approved') {
    throw new Error(`Approval ${item.id} has terminal state ${item.state}.`);
  }
  return {
    id: item.id,
    action: item.action,
    why: item.why,
    payload: item.payload,
    tier: 'yellow',
    resourceRefs: item.resourceRefs,
    state: item.state,
    createdAt: item.createdAt,
  };
}

async function findForCaller(
  ctx: RequestContext,
  approvalId: string,
  deps: ApprovalLifecycleHandlerDeps,
): Promise<BriefingItem | null> {
  return deps.store.findApprovalForUser(ctx.userId, approvalId);
}

async function transition(
  approvalId: string,
  state: BriefingItemState,
  deps: ApprovalLifecycleHandlerDeps,
  payload?: Record<string, unknown>,
): Promise<BriefingItem> {
  if (!deps.store.updateItemState) throw new Error('Approval state persistence is unavailable.');
  return deps.store.updateItemState(approvalId, { state, ...(payload ? { payload } : {}) });
}

export async function listPendingApprovals(
  ctx: RequestContext,
  deps: ApprovalLifecycleHandlerDeps,
): Promise<HandlerResponse<PendingApprovalListResponse>> {
  const items = await deps.store.listPendingApprovals(ctx.userId);
  return ok({ data: items.map(pendingFromItem) });
}

/** Mint does not accept or require a pre-existing token. */
export async function mintPendingApproval(
  ctx: RequestContext,
  approvalId: string,
  body: unknown,
  deps: ApprovalLifecycleHandlerDeps,
): Promise<HandlerResponse<ApprovalMintResponse>> {
  const parsed = approvalMintRequestSchema.safeParse(body);
  if (!parsed.success) return invalid(ctx, 'Invalid approval mint request.');
  if (parsed.data.approvalId !== approvalId) {
    return invalid(ctx, 'Body approvalId must match the route approval id.');
  }
  const item = await findForCaller(ctx, approvalId, deps);
  if (!item) return notFound(ctx, approvalId);
  if (item.autonomyTier !== 'yellow') {
    return errorResponse('capability_denied', 'Only Yellow approvals can mint a token.', {
      details: { tier: item.autonomyTier },
      traceId: ctx.traceId,
    });
  }
  if (item.state === 'denied' || item.state === 'executed') {
    return errorResponse('conflict', `Approval is terminal: ${item.state}.`, {
      details: { state: item.state },
      traceId: ctx.traceId,
    });
  }
  if (item.state !== 'proposed' && item.state !== 'approved') {
    return invalid(ctx, `Approval cannot be minted from state ${item.state}.`, { state: item.state });
  }
  if (hashPayload(parsed.data.payload) !== hashPayload(item.payload)) {
    return invalid(ctx, 'The approved payload must exactly match the persisted payload.', {
      reason: 'payload_mismatch',
    });
  }

  const at = now(deps);
  await deps.tokenStore.invalidateForApproval(approvalId, at.getTime());
  const ttlMs = deps.approvalTtlMs ?? DEFAULT_APPROVAL_LIFECYCLE_TTL_MS;
  const token = await mintApprovalToken({
    userId: ctx.userId,
    approvalId,
    action: item.action,
    payload: parsed.data.payload,
    ttlMs,
    secret: deps.approvalSecret,
    store: deps.tokenStore,
    now: () => at.getTime(),
  });
  await transition(approvalId, 'approved', deps);
  await deps.audit.append({
    userId: ctx.userId,
    actor: 'user',
    action: 'approval.mint',
    target: approvalId,
    reason: `Single-use token minted for ${item.action} and exact payload hash.`,
    traceId: ctx.traceId,
  });
  return ok({
    token,
    expiresAt: new Date(at.getTime() + ttlMs).toISOString(),
    action: item.action,
    payloadHash: hashPayload(parsed.data.payload),
  });
}

/** Edit returns to proposed, preserving re-approvability. */
export async function editPendingApproval(
  ctx: RequestContext,
  approvalId: string,
  body: unknown,
  deps: ApprovalLifecycleHandlerDeps,
): Promise<HandlerResponse<ApprovalEditResponse>> {
  const parsed = approvalMintRequestSchema.safeParse(body);
  if (!parsed.success) return invalid(ctx, 'Invalid approval edit request.');
  if (parsed.data.approvalId !== approvalId) {
    return invalid(ctx, 'Body approvalId must match the route approval id.');
  }
  const item = await findForCaller(ctx, approvalId, deps);
  if (!item) return notFound(ctx, approvalId);
  if (item.state === 'denied' || item.state === 'executed') {
    return errorResponse('conflict', `Approval is terminal: ${item.state}.`, {
      details: { state: item.state },
      traceId: ctx.traceId,
    });
  }
  if (item.state !== 'proposed' && item.state !== 'approved') {
    return invalid(ctx, `Approval cannot be edited from state ${item.state}.`, { state: item.state });
  }

  const updated = await transition(approvalId, 'proposed', deps, parsed.data.payload);
  await deps.audit.append({
    userId: ctx.userId,
    actor: 'user',
    action: 'approval.edit',
    target: approvalId,
    reason: 'Payload edited; prior grants no longer match its payload hash and re-approval is required.',
    traceId: ctx.traceId,
  });
  return ok({ approvalId, state: 'proposed', payload: updated.payload });
}

/** Gate verification and atomic consumption happen before the executor. */
export async function executePendingApproval(
  ctx: RequestContext,
  approvalId: string,
  body: unknown,
  deps: ApprovalLifecycleHandlerDeps,
): Promise<HandlerResponse<ApprovalExecuteResponse>> {
  const parsed = approvalExecuteRequestSchema.safeParse(body);
  if (!parsed.success) return invalid(ctx, 'Invalid approval execute request.');
  const item = await findForCaller(ctx, approvalId, deps);
  if (!item) return notFound(ctx, approvalId);
  if (item.state === 'denied') {
    return errorResponse('conflict', 'Denied approvals cannot execute.', {
      details: { state: item.state },
      traceId: ctx.traceId,
    });
  }
  if (item.state !== 'proposed' && item.state !== 'approved' && item.state !== 'executed') {
    return invalid(ctx, 'Approval is not executable.', { state: item.state });
  }
  const verdict = await enforce(
    {
      userId: ctx.userId,
      action: item.action,
      payload: parsed.data.payload,
      approvalToken: parsed.data.token,
      actor: 'user',
      traceId: ctx.traceId,
      target: approvalId,
    },
    {
      secret: deps.approvalSecret,
      tokenStore: deps.tokenStore,
      audit: deps.audit,
      now: () => now(deps).getTime(),
    },
  );
  if (!verdict.allowed) {
    return errorResponse('capability_denied', 'Approval token was refused.', {
      details: { reason: publicGateReason(verdict.reason), gateReason: verdict.reason },
      traceId: ctx.traceId,
    });
  }
  if (hashPayload(parsed.data.payload) !== hashPayload(item.payload)) {
    return errorResponse('capability_denied', 'Execution payload does not match the current approval.', {
      details: { reason: 'payload_mismatch' },
      traceId: ctx.traceId,
    });
  }

  try {
    const result = await deps.executor.execute({
      userId: ctx.userId,
      approvalId,
      action: item.action,
      payload: parsed.data.payload,
    });
    const executedAt = now(deps).toISOString();
    await transition(approvalId, 'executed', deps);
    await deps.audit.append({
      userId: ctx.userId,
      actor: 'user',
      action: 'approval.execute',
      target: approvalId,
      reason: `Executed ${item.action}: ${result.outcome}`,
      traceId: ctx.traceId,
    });
    return ok({
      approvalId,
      action: item.action,
      state: 'executed',
      outcome: result.outcome,
      executedAt,
    });
  } catch (cause) {
    await deps.audit.append({
      userId: ctx.userId,
      actor: 'system',
      action: 'approval.execute_failed',
      target: approvalId,
      reason: cause instanceof Error ? cause.message : 'Approval executor failed.',
      traceId: ctx.traceId,
    });
    return errorResponse('internal', 'Approved action execution failed; request a fresh approval.', {
      details: { reason: 'executor_failed' },
      traceId: ctx.traceId,
    });
  }
}

/** Denial is terminal and invalidates every live grant for the item. */
export async function denyPendingApproval(
  ctx: RequestContext,
  approvalId: string,
  body: unknown,
  deps: ApprovalLifecycleHandlerDeps,
): Promise<HandlerResponse<ApprovalDenyResponse>> {
  const parsed = approvalDenyRequestSchema.safeParse(body);
  if (!parsed.success) return invalid(ctx, 'Invalid approval denial request.');
  if (parsed.data.approvalId !== approvalId) {
    return invalid(ctx, 'Body approvalId must match the route approval id.');
  }
  const item = await findForCaller(ctx, approvalId, deps);
  if (!item) return notFound(ctx, approvalId);
  if (item.state === 'denied' || item.state === 'executed') {
    return errorResponse('conflict', `Approval is terminal: ${item.state}.`, {
      details: { state: item.state },
      traceId: ctx.traceId,
    });
  }
  if (item.state !== 'proposed' && item.state !== 'approved') {
    return invalid(ctx, `Approval cannot be denied from state ${item.state}.`, { state: item.state });
  }
  const deniedAt = now(deps);
  await deps.tokenStore.invalidateForApproval(approvalId, deniedAt.getTime());
  await transition(approvalId, 'denied', deps);
  await deps.audit.append({
    userId: ctx.userId,
    actor: 'user',
    action: 'approval.deny',
    target: approvalId,
    reason: parsed.data.reason,
    traceId: ctx.traceId,
  });
  return ok({ approvalId, state: 'denied', deniedAt: deniedAt.toISOString() });
}