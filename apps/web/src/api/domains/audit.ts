/**
 * `audit` domain — the caller's slice of the immutable audit log (M07).
 *
 * Endpoint: `GET /v1/audit?limit=&before=` (docs/api-spec.md §Briefings).
 * READ-ONLY; the server enforces per-user scoping from the bearer, and the
 * store itself is append-only (no client mutation is possible).
 *
 * The `AuditRow` shape is not yet exported through `@careeros/contracts`; the
 * wire schema is defined here as a transport contract, matching
 * `apps/api/src/modules/audit/audit.handlers.ts` 1:1.
 */
import { z } from 'zod';
import type { ApiClient, RequestOptions } from '../client.js';

export const auditRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  actor: z.enum(['user', 'twin', 'system']),
  action: z.string().min(1),
  target: z.string().nullable(),
  reason: z.string(),
  modelVersion: z.string().nullable(),
  traceId: z.string().nullable(),
  at: z.string().datetime(),
});
export type AuditRow = z.infer<typeof auditRowSchema>;

export const auditListResponseSchema = z.object({
  data: z.array(auditRowSchema),
  /** ISO timestamp c‍ursor for the next page; `null` when done. */
  nextBefore: z.string().datetime().nullable(),
});
export type AuditListResponse = z.infer<typeof auditListResponseSchema>;

export interface AuditListQuery {
  /** Page size, server-clamped to a max (see handler). */
  limit?: number;
  /** ISO timestamp, exclusive — pass `nextBefore` from the previous page. */
  before?: string;
}

export interface AuditApi {
  /** GET /v1/audit — page over the caller's audit rows, newest first. */
  list(query?: AuditListQuery, opts?: RequestOptions): Promise<AuditListResponse>;
}

export function createAuditApi(client: ApiClient): AuditApi {
  return {
    list: (query, opts) =>
      client.get('/v1/audit', auditListResponseSchema, {
        ...opts,
        query: {
          ...(query?.limit !== undefined ? { limit: query.limit } : {}),
          ...(query?.before !== undefined ? { before: query.before } : {}),
        },
      }),
  };
}