/**
 * M07 — GET /v1/audit.
 *
 * Exposes the caller's slice of the immutable audit log. PER-USER by
 * construction: the port only accepts a `userId` filter, and the handler
 * pipes the verified `ctx.userId` unmodified. Rows are ordered newest→oldest
 * with a hard page cap so we cannot accidentally fan out a full-table scan.
 *
 * The audit log is append-only at the storage layer (`PrismaAuditSink`
 * writes only; no UPDATE/DELETE code paths exist). This handler is READ-ONLY;
 * it never mutates a row, so we do not need capability-gate protection —
 * the BearerAuthGuard's per-user scope is the whole story.
 */
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';

/**
 * Read-only projection of an audit row. Mirrors the persisted schema and
 * @careeros/observability's AuditRecord.
 */
export interface AuditRow {
  id: string;
  userId: string;
  actor: 'user' | 'twin' | 'system';
  action: string;
  target: string | null;
  reason: string;
  modelVersion: string | null;
  traceId: string | null;
  at: string;
}

/**
 * Read port for the immutable audit log. The Prisma-backed implementation
 * lives in @careeros/db; apps/api depends only on this shape.
 */
export interface AuditReadPort {
  listForUser(
    userId: string,
    input: { limit: number; before?: string | undefined },
  ): Promise<{ data: AuditRow[]; nextBefore: string | null }>;
}

export interface AuditHandlerDeps {
  audit: AuditReadPort;
  /** Default page size when the caller omits ?limit. */
  defaultLimit?: number;
  /** Maximum page size we will honor; caps runaway ?limit values. */
  maxLimit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /v1/audit — page over the caller's audit rows, newest first.
 * Query params: `limit` (1..maxLimit), `before` (ISO timestamp, exclusive).
 */
export async function listAudit(
  ctx: RequestContext,
  query: Record<string, string | undefined>,
  deps: AuditHandlerDeps,
): Promise<HandlerResponse<{ data: AuditRow[]; nextBefore: string | null }>> {
  const max = deps.maxLimit ?? MAX_LIMIT;
  const dflt = deps.defaultLimit ?? DEFAULT_LIMIT;

  const rawLimit = query['limit'];
  let limit = dflt;
  if (rawLimit !== undefined) {
    const n = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return errorResponse('validation_failed', '`limit` must be a positive integer.', {
        traceId: ctx.traceId,
      });
    }
    limit = Math.min(n, max);
  }

  const before = query['before'];
  if (before !== undefined && Number.isNaN(new Date(before).getTime())) {
    return errorResponse('validation_failed', '`before` must be an ISO-8601 timestamp.', {
      traceId: ctx.traceId,
    });
  }

  const page = await deps.audit.listForUser(ctx.userId, { limit, before });
  return ok(page);
}