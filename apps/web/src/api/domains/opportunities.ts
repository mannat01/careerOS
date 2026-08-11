/**
 * `opportunities` domain — read-only browse, detail, and grounded match views.
 *
 * The canonical `Opportunity` shape is imported from `@careeros/contracts`
 * (`opportunitySchema`) — this module composes the client with that schema,
 * it does NOT re-declare it. Ingest/score endpoints are server-side Green
 * jobs; the web app only reads.
 *
 * `userId` never crosses this boundary — server derives from the bearer.
 */
import {
  opportunityDetailSchema,
  opportunityListResponseSchema,
  opportunityMatchResponseSchema,
  type OpportunityDetail,
  type OpportunityListResponse,
  type OpportunityMatchResponse,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client';

/**
 * List envelope — the wire shape for `GET /v1/opportunities`. The individual
 * `Opportunity` items are the contract shape from `@careeros/contracts`; only
 * the pagination envelope is defined here (it is a client-facing convenience
 * layer and does not live in the domain contracts).
 */
export interface OpportunitiesListQuery {
  /** Pagination cursor from a previous response's `nextCursor`. */
  cursor?: string;
  /** Client-side page size hint; server may clamp. */
  limit?: number;
  /** SourceRegistry key, e.g. greenhouse, lever, or usajobs. */
  source?: string;
  /** Restrict to remote (`true`) or non-remote (`false`) roles. */
  remote?: boolean;
  /** Restrict to postings that carry compensation data. */
  comp?: boolean;
  /** Restrict to postings ingested within the last N days. */
  freshness?: number;
}

export interface OpportunitiesApi {
  /** GET /v1/opportunities — paginated list of scored opportunities. */
  list(query?: OpportunitiesListQuery, opts?: RequestOptions): Promise<OpportunityListResponse>;
  /** GET /v1/opportunities/:id — one opportunity, with parsed requirements. */
  get(id: string, opts?: RequestOptions): Promise<OpportunityDetail>;
  /** GET /v1/opportunities/:id/match — the caller's grounded match score. */
  match(id: string, opts?: RequestOptions): Promise<OpportunityMatchResponse>;
}

export function createOpportunitiesApi(client: ApiClient): OpportunitiesApi {
  return {
    list: (query, opts) =>
      client.get('/v1/opportunities', opportunityListResponseSchema, {
        ...opts,
        query: {
          ...(query?.cursor !== undefined ? { cursor: query.cursor } : {}),
          ...(query?.limit !== undefined ? { limit: query.limit } : {}),
          ...(query?.source !== undefined ? { source: query.source } : {}),
          ...(query?.remote !== undefined ? { remote: query.remote } : {}),
          ...(query?.comp !== undefined ? { comp: query.comp } : {}),
          ...(query?.freshness !== undefined ? { freshness: query.freshness } : {}),
        },
      }),
    get: (id, opts) => client.get(`/v1/opportunities/${encodeURIComponent(id)}`, opportunityDetailSchema, opts),
    match: (id, opts) =>
      client.get(`/v1/opportunities/${encodeURIComponent(id)}/match`, opportunityMatchResponseSchema, opts),
  };
}