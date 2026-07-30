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
 * The BriefingRun / BriefingItem persisted shapes live in
 * `apps/api/src/modules/briefing` and are not (yet) surfaced through
 * `@careeros/contracts` — this module defines the wire schema locally as a
 * transport contract. When contracts are extended, we swap the import.
 *
 * `userId` is server-derived. Approval of a Yellow item goes through the
 * ApprovalDialog which mints an `ApprovalToken`; the item-execute path
 * demonstrates the type-level guard: no token → compile error.
 */
import { z } from 'zod';
import type { ApiClient, RequestOptions } from '../client.js';
import type { ApprovalToken } from '../approval.js';

// ---------- wire schemas ----------

export const briefingItemKindSchema = z.enum([
  'opportunity',
  'tailored_resume',
  'draft',
  'prep',
  'gap',
  'note',
  'focus',
  'suggestion',
]);

export const briefingItemStateSchema = z.enum([
  'proposed',
  'approved',
  'edited',
  'skipped',
  'failed',
]);

export const autonomyTierWireSchema = z.enum(['green', 'yellow', 'red']);

export const briefingItemSchema = z.object({
  id: z.string().uuid(),
  kind: briefingItemKindSchema,
  refId: z.string().nullable(),
  autonomyTier: autonomyTierWireSchema,
  state: briefingItemStateSchema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type BriefingItem = z.infer<typeof briefingItemSchema>;

export const briefingStepRecordSchema = z.object({
  name: z.string().min(1),
  status: z.enum(['ok', 'failed', 'skipped']),
  costUsd: z.number().nonnegative(),
  traceId: z.string(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  itemsProduced: z.number().int().nonnegative(),
  error: z.string().optional(),
  retryable: z.boolean().optional(),
});

export const briefingRunSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  trigger: z.enum(['scheduled', 'manual']),
  status: z.enum(['queued', 'running', 'partial', 'complete', 'failed']),
  inputs: z.record(z.string(), z.unknown()),
  steps: z.array(briefingStepRecordSchema),
  costTotal: z.number().nonnegative(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
});
export type BriefingRun = z.infer<typeof briefingRunSchema>;

export const briefingRunDetailSchema = briefingRunSchema.extend({
  items: z.array(briefingItemSchema),
});
export type BriefingRunDetail = z.infer<typeof briefingRunDetailSchema>;

/** Run-manual request. `trigger` is always `manual` from the web client. */
export const runManualBriefingRequestSchema = z.object({
  trigger: z.literal('manual'),
});
export type RunManualBriefingRequest = z.infer<typeof runManualBriefingRequestSchema>;

export const runManualBriefingResponseSchema = z.object({
  briefingRunId: z.string().uuid(),
});
export type RunManualBriefingResponse = z.infer<typeof runManualBriefingResponseSchema>;

/** Edit payload — fields the user tweaked before approving. Free-form record so we
 *  don't need to re-declare item-kind-specific shapes here (server enforces). */
export const editBriefingItemRequestSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
});
export type EditBriefingItemRequest = z.infer<typeof editBriefingItemRequestSchema>;

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
        { trigger: 'manual' } satisfies RunManualBriefingRequest,
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