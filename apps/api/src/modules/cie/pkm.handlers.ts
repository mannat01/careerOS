/**
 * M10 Step 5 — Personal Knowledge Management endpoints (Green, per-user scoped).
 *
 *   POST   /v1/pkm            → create a note / journal / saved entry
 *   GET    /v1/pkm            → list caller's entries (optional ?kind=)
 *   GET    /v1/pkm/:id        → get one (per-user; cross-user → 404)
 *   DELETE /v1/pkm/:id        → delete + PURGE the derived graph contribution
 *
 * Every operation is scoped to the verified `ctx.userId` — handlers NEVER
 * trust an id supplied via body/query. The service layer (@careeros/cie-pkm)
 * sanitizes the untrusted body BEFORE persistence or graph ingest, tags the
 * derived graph nodes with `pkm:user-authored:<entryId>` provenance, and
 * atomically purges that contribution on delete.
 *
 * DB-free: the handler depends on the narrow PkmService; the Prisma-backed
 * PkmStorePort + graph-ingest adapters live in the composition root.
 */
import { z, ZodError } from 'zod';
import type { PkmEntry, PkmKind, PkmService } from '@careeros/cie-pkm';
import { PKM_KINDS, pkmCreateSchema } from '@careeros/cie-pkm';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';

// ---------------- deps ----------------

export interface PkmHandlerDeps {
  pkm: PkmService;
}

// ---------------- response DTOs ----------------

/**
 * Wire shape returned to owners — includes `bodyRaw` so the owner sees exactly
 * what they typed. Cross-user reads are impossible (store returns null → 404),
 * so this DTO is never exposed to another user.
 */
export interface PkmEntryDto {
  id: string;
  kind: PkmKind;
  title: string;
  body: string;
  bodySanitized: string;
  tags: string[];
  sourceUrl?: string;
  injectionFlagged: boolean;
  graphNodeIds: string[];
  createdAt: string;
  updatedAt: string;
}

function toDto(e: PkmEntry): PkmEntryDto {
  return {
    id: e.id,
    kind: e.kind,
    title: e.title,
    body: e.bodyRaw,
    bodySanitized: e.bodySanitized,
    tags: [...e.tags],
    ...(e.sourceUrl !== undefined ? { sourceUrl: e.sourceUrl } : {}),
    injectionFlagged: e.injectionFlagged,
    graphNodeIds: [...e.graphNodeIds],
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

// ---------------- list-query validation ----------------

const listQuerySchema = z.object({
  kind: z.enum(PKM_KINDS).optional(),
});

// ---------------- handlers ----------------

/** POST /v1/pkm — create a per-user PKM entry (sanitize → persist → graph). */
export async function createPkmEntry(
  ctx: RequestContext,
  body: unknown,
  deps: PkmHandlerDeps,
): Promise<HandlerResponse<PkmEntryDto>> {
  let parsed;
  try {
    parsed = pkmCreateSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return errorResponse('validation_failed', 'Invalid PKM entry.', {
        traceId: ctx.traceId,
        details: { issues: err.issues },
      });
    }
    return errorResponse('validation_failed', 'Invalid PKM entry.', { traceId: ctx.traceId });
  }
  try {
    const entry = await deps.pkm.create(ctx.userId, parsed);
    return { status: 201, body: toDto(entry) };
  } catch (err) {
    void err;
    return errorResponse('internal', 'Failed to create PKM entry.', {
      traceId: ctx.traceId,
    });
  }
}

/** GET /v1/pkm — list the caller's entries (optionally filtered by kind). */
export async function listPkmEntries(
  ctx: RequestContext,
  query: unknown,
  deps: PkmHandlerDeps,
): Promise<HandlerResponse<{ items: PkmEntryDto[] }>> {
  let q;
  try {
    q = listQuerySchema.parse(query ?? {});
  } catch (err) {
    if (err instanceof ZodError) {
      return errorResponse('validation_failed', 'Invalid query.', {
        traceId: ctx.traceId,
        details: { issues: err.issues },
      });
    }
    return errorResponse('validation_failed', 'Invalid query.', { traceId: ctx.traceId });
  }
  try {
    const rows = await deps.pkm.list(ctx.userId, q.kind);
    return ok({ items: rows.map(toDto) });
  } catch (err) {
    void err;
    return errorResponse('internal', 'Failed to list PKM entries.', {
      traceId: ctx.traceId,
    });
  }
}

/** GET /v1/pkm/:id — read one entry (per-user scoped; cross-user → 404). */
export async function getPkmEntry(
  ctx: RequestContext,
  id: string,
  deps: PkmHandlerDeps,
): Promise<HandlerResponse<PkmEntryDto>> {
  if (!id || typeof id !== 'string') {
    return errorResponse('validation_failed', 'Missing id.', { traceId: ctx.traceId });
  }
  try {
    const entry = await deps.pkm.get(ctx.userId, id);
    if (!entry) {
      return errorResponse('not_found', 'PKM entry not found.', { traceId: ctx.traceId });
    }
    return ok(toDto(entry));
  } catch (err) {
    void err;
    return errorResponse('internal', 'Failed to load PKM entry.', {
      traceId: ctx.traceId,
    });
  }
}

/**
 * DELETE /v1/pkm/:id — delete the entry AND purge its derived graph
 * contribution. Per-user scoped: a cross-user id returns 404 without touching
 * the owner's data.
 */
export async function deletePkmEntry(
  ctx: RequestContext,
  id: string,
  deps: PkmHandlerDeps,
): Promise<HandlerResponse<{ id: string; deleted: true }>> {
  if (!id || typeof id !== 'string') {
    return errorResponse('validation_failed', 'Missing id.', { traceId: ctx.traceId });
  }
  try {
    const okDel = await deps.pkm.delete(ctx.userId, id);
    if (!okDel) {
      return errorResponse('not_found', 'PKM entry not found.', { traceId: ctx.traceId });
    }
    return ok({ id, deleted: true as const });
  } catch (err) {
    void err;
    return errorResponse('internal', 'Failed to delete PKM entry.', {
      traceId: ctx.traceId,
    });
  }
}