/**
 * `briefings` domain — the daily/manual briefing loop (M05).
 *
 * Endpoints (docs/api-spec.md §Briefings):
 *   POST   /v1/briefings/run                    (Green — trigger a manual run)
 *   GET    /v1/briefings/:id                    (read run status + items)
 *   GET    /v1/briefings/latest                 (today's briefing for Home)
 *   POST   /v1/briefings/:id/items/:itemId/approve  (Yellow — needs token)
 *   POST   /v1/briefings/:id/items/:itemId/edit     (Green — item is still proposed)
 *   POST   /v1/briefings/:id/items/:itemId/skip     (Green — user opts out)
 *
 * The BriefingRun / BriefingItem wire shapes are parsed by the shared schemas
 * exported from `@careeros/contracts`; this module only composes the client.
 *
 * `userId` is server-derived. Approval of a Yellow item goes through the
 * ApprovalDialog which mints an `ApprovalToken`; the item-execute path
 * demonstrates the type-level guard: no token → compile error.
 */
import {
  briefingItemSchema,
  briefingRunDetailSchema,
  editBriefingItemRequestSchema,
  runManualBriefingRequestSchema,
  type BriefingItem,
  type BriefingRunDetail,
  type EditBriefingItemRequest,
  type RunManualBriefingRequest,
} from '@careeros/contracts';
import type { ApiClient, RequestOptions } from '../client.js';
import type { ApprovalToken } from '../approval.js';

// ---------- wire schemas ----------

export type BriefingRun = BriefingRunDetail;

/** Run-manual request. `trigger` is always `manual` from the web client. */
export const runManualBriefingResponseSchema = briefingRunDetailSchema;
export type RunManualBriefingResponse = BriefingRunDetail;

// ---------- api surface ----------

export interface BriefingsApi {
  /** POST /v1/briefings/run — enqueue a manual briefing (Green). */
  runManual(opts?: RequestOptions): Promise<RunManualBriefingResponse>;
  /** GET /v1/briefings/:id — one run + items. */
  get(id: string, opts?: RequestOptions): Promise<BriefingRunDetail>;
  /** GET /v1/briefings/latest — today's briefing for Home. */
  latest(opts?: RequestOptions): Promise<BriefingRunDetail>;
  /**
   * POST /v1/briefings/:runId/items/:itemId/approve — approve a Yellow item.
   * The `ApprovalToken` argument is compile-time required — a call without one
   * does not typecheck. The token was minted by the ApprovalDialog for
   * exactly this (user, action, payloadHash) triple.
   */
  approveItem(
    runId: string,
    itemId: string,
    approval: ApprovalToken,
    opts?: RequestOptions,
  ): Promise<BriefingItem>;
  /** POST /v1/briefings/:runId/items/:itemId/edit — user edited the item. Still `proposed`. */
  editItem(
    runId: string,
    itemId: string,
    body: EditBriefingItemRequest,
    opts?: RequestOptions,
  ): Promise<BriefingItem>;
  /** POST /v1/briefings/:runId/items/:itemId/skip — user skipped the item. */
  skipItem(runId: string, itemId: string, opts?: RequestOptions): Promise<BriefingItem>;
}

export function createBriefingsApi(client: ApiClient): BriefingsApi {
  return {
    runManual: (opts) =>
      client.postGreen(
        'briefing.generate',
        '/v1/briefings/run',
        runManualBriefingRequestSchema.parse({ trigger: 'manual' }) satisfies RunManualBriefingRequest,
        runManualBriefingResponseSchema,
        opts,
      ),
    get: (id, opts) =>
      client.get(
        `/v1/briefings/${encodeURIComponent(id)}`,
        briefingRunDetailSchema,
        opts,
      ),
    latest: (opts) => client.get('/v1/briefings/latest', briefingRunDetailSchema, opts),
    approveItem: (runId, itemId, approval, opts) =>
      client.postYellow(
        'briefing.item.execute',
        `/v1/briefings/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/approve`,
        undefined,
        briefingItemSchema,
        approval,
        opts,
      ),
    editItem: (runId, itemId, body, opts) => {
      const parsed = editBriefingItemRequestSchema.parse(body);
      // "Edit" keeps the item in `proposed` — it's not the act-side of the
      // approve/edit/skip trio, it's the mutation of the proposal itself, so
      // it does NOT require an ApprovalToken. Server tags it Green.
      return client.postGreen(
        null,
        `/v1/briefings/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/edit`,
        parsed,
        briefingItemSchema,
        opts,
      );
    },
    skipItem: (runId, itemId, opts) =>
      client.postGreen(
        null,
        `/v1/briefings/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/skip`,
        undefined,
        briefingItemSchema,
        opts,
      ),
  };
}