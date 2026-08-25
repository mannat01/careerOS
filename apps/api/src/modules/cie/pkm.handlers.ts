import {
  pkmCreateRequestSchema,
  pkmDeleteResponseSchema,
  pkmEntrySchema,
  pkmListResponseSchema,
  pkmUpdateRequestSchema,
  type PkmEntry,
  type PkmDeleteResponse,
  type PkmListResponse,
} from '@careeros/contracts';
import { z } from 'zod';
import type { PkmService } from '@careeros/cie-pkm';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';

export interface PkmHandlerDeps {
  pkm: PkmService;
}

const pkmIdSchema = z.string().uuid();

function validationError(ctx: RequestContext, issues: unknown): HandlerResponse<never> {
  return errorResponse('validation_failed', 'Invalid PKM entry.', {
    traceId: ctx.traceId,
    details: { issues },
  });
}

/** POST /v1/pkm — caller-scoped Green action; server controls identity + provenance. */
export async function createPkmEntry(
  ctx: RequestContext,
  body: unknown,
  deps: PkmHandlerDeps,
): Promise<HandlerResponse<PkmEntry>> {
  const parsed = pkmCreateRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(ctx, parsed.error.issues);
  const entry = await deps.pkm.create(ctx.userId, parsed.data);
  return { status: 201, body: pkmEntrySchema.parse(entry) };
}

/** GET /v1/pkm — only the verified caller's entries. */
export async function listPkmEntries(
  ctx: RequestContext,
  query: unknown,
  deps: PkmHandlerDeps,
): Promise<HandlerResponse<PkmListResponse>> {
  if (query !== undefined && (typeof query !== 'object' || query === null || Object.keys(query).length > 0)) {
    return validationError(ctx, ['query: unknown keys are not allowed']);
  }
  return ok(pkmListResponseSchema.parse({ data: await deps.pkm.list(ctx.userId) }));
}

/** GET /v1/pkm/:id — owner-only; missing and cross-owner ids both return 404. */
export async function getPkmEntry(
  ctx: RequestContext,
  id: string,
  deps: PkmHandlerDeps,
): Promise<HandlerResponse<PkmEntry>> {
  if (!pkmIdSchema.safeParse(id).success) return validationError(ctx, ['id: Invalid uuid']);
  const entry = await deps.pkm.get(ctx.userId, id);
  if (!entry) return errorResponse('not_found', 'PKM entry not found.', { traceId: ctx.traceId });
  return ok(pkmEntrySchema.parse(entry));
}

/** PATCH /v1/pkm/:id — owner-only; provenance cannot be changed. */
export async function updatePkmEntry(
  ctx: RequestContext,
  id: string,
  body: unknown,
  deps: PkmHandlerDeps,
): Promise<HandlerResponse<PkmEntry>> {
  if (!pkmIdSchema.safeParse(id).success) return validationError(ctx, ['id: Invalid uuid']);
  const parsed = pkmUpdateRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(ctx, parsed.error.issues);
  const entry = await deps.pkm.update(ctx.userId, id, parsed.data);
  if (!entry) return errorResponse('not_found', 'PKM entry not found.', { traceId: ctx.traceId });
  return ok(pkmEntrySchema.parse(entry));
}

/** DELETE /v1/pkm/:id — owner-only and audited. */
export async function deletePkmEntry(
  ctx: RequestContext,
  id: string,
  deps: PkmHandlerDeps,
): Promise<HandlerResponse<PkmDeleteResponse>> {
  if (!pkmIdSchema.safeParse(id).success) return validationError(ctx, ['id: Invalid uuid']);
  const deleted = await deps.pkm.delete(ctx.userId, id);
  if (!deleted) return errorResponse('not_found', 'PKM entry not found.', { traceId: ctx.traceId });
  return ok(pkmDeleteResponseSchema.parse({ id, deleted: true }));
}