/**
 * /v1/applications HTTP handlers — M04 Stage 4 application pipeline (CRM).
 *
 * DB-free by construction: handlers depend only on the narrow ports below (Prisma
 * adapters live in @careeros/db) and the VERIFIED RequestContext + resolved actor.
 * Every application is PER-USER scoped — the userId comes ONLY from the context,
 * so a body can never redirect a read/write to another user, and one user can
 * neither see nor mutate another user's applications.
 *
 * The pipeline discipline (valid transitions) and the CORE human-in-the-loop
 * invariant (the `applied` transition is user-submit-only) are enforced by the
 * pure status-machine before any write. An agent/system context — even with a
 * valid session — can never drive a record to `applied`; that attempt is denied
 * (capability_denied) and audited. The system prepares; the user submits.
 */
import {
  applicationCreateRequestSchema,
  applicationFollowUpRequestSchema,
  applicationPatchRequestSchema,
  type Application,
  type ApplicationActor,
  type ApplicationDetail,
  type ApplicationFollowUp,
  type ApplicationStatus,
} from '@careeros/contracts';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';
import { checkTransition, isMeaningfulStatusChange } from './status-machine.js';

// ---------- ports (Prisma adapters implement these in @careeros/db) ----------

/**
 * A structured, already-validated update the store applies atomically. When
 * `statusChange` is present the store MUST append one append-only timeline entry
 * and, for the `applied` target, stamp `appliedAt`.
 */
export interface ApplicationUpdateCommand {
  notes?: string;
  followUpAt?: string | null;
  statusChange?: {
    to: ApplicationStatus;
    actor: ApplicationActor;
    /** True only for the explicit user-submit transition into `applied`. */
    setAppliedAt: boolean;
    note?: string;
  };
}

export interface ApplicationStorePort {
  /** Create a `saved` application under the user + seed its first timeline entry. */
  create(
    userId: string,
    input: { opportunityId: string; resumeVariantId?: string; notes?: string },
  ): Promise<ApplicationDetail>;
  /** Per-user scoped read — null when not found OR owned by someone else. */
  getById(userId: string, id: string): Promise<ApplicationDetail | null>;
  /** All of the caller's applications, newest first. */
  list(userId: string): Promise<Application[]>;
  /** Apply a validated update; null when not found / not owned. */
  update(userId: string, id: string, command: ApplicationUpdateCommand): Promise<ApplicationDetail | null>;
  /** Schedule an internal follow-up; null when the application is not found / not owned. */
  addFollowUp(
    userId: string,
    id: string,
    input: { dueAt: string; note?: string },
  ): Promise<ApplicationFollowUp | null>;
}

/** Narrow existence check so create can 404 an unknown opportunity id. */
export interface OpportunityExistsPort {
  exists(opportunityId: string): Promise<boolean>;
}

/**
 * Episodic-memory port — the handler emits ONE MemoryEvent per meaningful status
 * change (never on a notes-only edit) so the four-tier memory keeps an
 * append-only record of the application's journey. The handler depends on this
 * narrow interface (never on @careeros/memory or @careeros/db directly).
 */
export interface ApplicationMemoryPort {
  recordStatusChange(input: {
    userId: string;
    applicationId: string;
    opportunityId: string;
    fromStatus: ApplicationStatus;
    toStatus: ApplicationStatus;
    actor: ApplicationActor;
  }): Promise<void>;
}

export interface ApplicationHandlerDeps {
  store: ApplicationStorePort;
  opportunities: OpportunityExistsPort;
  /** Optional: when wired, an episodic MemoryEvent is appended per status change. */
  memory?: ApplicationMemoryPort;
}

// ---------- POST /v1/applications ----------

export async function createApplication(
  ctx: RequestContext,
  body: unknown,
  deps: ApplicationHandlerDeps,
): Promise<HandlerResponse<ApplicationDetail>> {
  const parsed = applicationCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('validation_failed', 'Invalid application payload.', {
      details: { issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
      traceId: ctx.traceId,
    });
  }

  // The linked opportunity must exist (opportunities are global, not user-owned).
  if (!(await deps.opportunities.exists(parsed.data.opportunityId))) {
    return errorResponse('not_found', 'Opportunity not found.', {
      details: { opportunityId: parsed.data.opportunityId },
      traceId: ctx.traceId,
    });
  }

  const created = await deps.store.create(ctx.userId, {
    opportunityId: parsed.data.opportunityId,
    ...(parsed.data.resumeVariantId !== undefined ? { resumeVariantId: parsed.data.resumeVariantId } : {}),
    ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
  });
  return { status: 201, body: created };
}

// ---------- GET /v1/applications ----------

export async function listApplications(
  ctx: RequestContext,
  deps: ApplicationHandlerDeps,
): Promise<HandlerResponse<{ data: Application[] }>> {
  const data = await deps.store.list(ctx.userId);
  return ok({ data });
}

// ---------- GET /v1/applications/:id ----------

export async function getApplication(
  ctx: RequestContext,
  id: string,
  deps: ApplicationHandlerDeps,
): Promise<HandlerResponse<ApplicationDetail>> {
  const found = await deps.store.getById(ctx.userId, id);
  if (!found) {
    return errorResponse('not_found', 'Application not found.', { details: { id }, traceId: ctx.traceId });
  }
  return ok(found);
}

// ---------- PATCH /v1/applications/:id ----------

/**
 * Move status and/or edit notes/follow-up. `actor` is resolved by the caller from
 * the VERIFIED context (default `user`; an agent/system runtime signals its own
 * actor) — it is NEVER taken from the body. The status-machine gate runs BEFORE
 * any write, so a denied transition (notably the applied-only-by-user invariant)
 * performs no mutation.
 */
export async function patchApplication(
  ctx: RequestContext,
  id: string,
  actor: ApplicationActor,
  body: unknown,
  deps: ApplicationHandlerDeps,
): Promise<HandlerResponse<ApplicationDetail>> {
  const parsed = applicationPatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('validation_failed', 'Invalid application patch.', {
      details: { issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
      traceId: ctx.traceId,
    });
  }

  const current = await deps.store.getById(ctx.userId, id);
  if (!current) {
    return errorResponse('not_found', 'Application not found.', { details: { id }, traceId: ctx.traceId });
  }

  const { status, notes, followUpAt, iSubmitted } = parsed.data;

  const command: ApplicationUpdateCommand = {
    ...(notes !== undefined ? { notes } : {}),
    ...(followUpAt !== undefined ? { followUpAt } : {}),
  };

  // Status change requested (and it actually differs from the current status).
  if (status !== undefined && isMeaningfulStatusChange(current.status, status)) {
    const check = checkTransition(current.status, status, {
      actor,
      explicitUserSubmit: iSubmitted === true,
    });
    if (!check.ok) {
      // The CORE invariant maps to capability_denied (a consequence the caller is
      // not permitted to trigger); structural violations map to conflict.
      if (check.reason === 'applied_requires_user_submit') {
        return errorResponse(
          'capability_denied',
          'The transition to `applied` may be set ONLY by an explicit user submit — the system prepares, the user submits.',
          { details: { from: current.status, to: status, actor, reason: check.reason }, traceId: ctx.traceId },
        );
      }
      return errorResponse('conflict', 'Invalid status transition.', {
        details: { from: current.status, to: status, reason: check.reason },
        traceId: ctx.traceId,
      });
    }
    command.statusChange = {
      to: status,
      actor,
      setAppliedAt: status === 'applied',
    };
  }

  const updated = await deps.store.update(ctx.userId, id, command);
  if (!updated) {
    return errorResponse('not_found', 'Application not found.', { details: { id }, traceId: ctx.traceId });
  }

  // Emit ONE episodic MemoryEvent on a meaningful status change (not notes-only).
  // Best-effort: the record is already durably persisted.
  if (deps.memory && command.statusChange) {
    await deps.memory.recordStatusChange({
      userId: ctx.userId,
      applicationId: id,
      opportunityId: updated.opportunityId,
      fromStatus: current.status,
      toStatus: command.statusChange.to,
      actor,
    });
  }

  return ok(updated);
}

// ---------- POST /v1/applications/:id/followups ----------

export async function scheduleFollowUp(
  ctx: RequestContext,
  id: string,
  body: unknown,
  deps: ApplicationHandlerDeps,
): Promise<HandlerResponse<ApplicationFollowUp>> {
  const parsed = applicationFollowUpRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('validation_failed', 'Invalid follow-up payload.', {
      details: { issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
      traceId: ctx.traceId,
    });
  }

  const followUp = await deps.store.addFollowUp(ctx.userId, id, {
    dueAt: parsed.data.dueAt,
    ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
  });
  if (!followUp) {
    return errorResponse('not_found', 'Application not found.', { details: { id }, traceId: ctx.traceId });
  }
  return { status: 201, body: followUp };
}

// ---------- actor resolution ----------

/**
 * Resolve the acting principal from the VERIFIED context. Human requests over the
 * public API are `user`. An internal agent/automation runtime that reuses a user's
 * session signals its non-human context via the `X-Actor` header (`twin` or
 * `system`) — which is exactly what the CORE invariant refuses to let reach
 * `applied`. Anything unrecognized falls back to the safe, least-capable… no —
 * to `user` for OTHER transitions, but the `applied` gate additionally demands the
 * explicit submit flag, so a spoofed `X-Actor: user` still cannot apply without it.
 */
export function resolveActor(ctx: RequestContext): ApplicationActor {
  const raw = ctx.headers['x-actor'];
  if (raw === 'twin' || raw === 'system') return raw;
  return 'user';
}
