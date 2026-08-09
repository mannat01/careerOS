/**
 * `audit` domain — the caller's slice of the immutable audit log (M07).
 *
 * Endpoint: `GET /v1/audit?limit=&before=` (docs/api-spec.md §Briefings).
 * READ-ONLY; the server enforces per-user scoping from the bearer, and the
 * store itself is append-only (no client mutation is possible).
 *
 * The wire response is parsed by the shared schema exported from
 * `@careeros/contracts`; this module only composes the typed client.
 */
import {
  auditListResponseSchema,
  type AuditEntry,
  type AuditListResponse,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client.js';

export type AuditRow = AuditEntry;

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