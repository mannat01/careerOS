import { z } from 'zod';
import { autonomyTierSchema } from './autonomy.js';

export const briefingTriggerSchema = z.enum(['scheduled', 'manual']);
export type BriefingTrigger = z.infer<typeof briefingTriggerSchema>;

export const briefingRunStatusSchema = z.enum(['queued', 'running', 'partial', 'complete', 'failed']);
export type BriefingRunStatus = z.infer<typeof briefingRunStatusSchema>;

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
export type BriefingItemKind = z.infer<typeof briefingItemKindSchema>;

export const briefingItemStateSchema = z.enum([
  'proposed',
  'approved',
  'edited',
  'executed',
  'denied',
  'skipped',
  'failed',
]);
export type BriefingItemState = z.infer<typeof briefingItemStateSchema>;

export const briefingStepNameSchema = z.string().min(1);
export const briefingStepStatusSchema = z.enum(['ok', 'failed', 'skipped']);

export const briefingStepRecordSchema = z
  .object({
    name: briefingStepNameSchema,
    status: briefingStepStatusSchema,
    costUsd: z.number().nonnegative(),
    traceId: z.string().min(1),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    itemsProduced: z.number().int().nonnegative(),
    error: z.string().optional(),
    retryable: z.boolean().optional(),
  })
  .strict();
export type BriefingStepRecord = z.infer<typeof briefingStepRecordSchema>;

/** One item in a briefing run. `payload` is intentionally opaque JSON by design. */
export const briefingItemSchema = z
  .object({
    id: z.string().min(1),
    kind: briefingItemKindSchema,
    refId: z.string().nullable(),
    autonomyTier: autonomyTierSchema,
    state: briefingItemStateSchema,
    payload: z.record(z.string(), z.unknown()),
    /** First-class lifecycle metadata. Optional only for legacy briefing readers. */
    action: z.string().min(1).optional(),
    why: z.string().min(1).optional(),
    resourceRefs: z
      .array(z.object({ type: z.string().min(1), id: z.string().min(1) }).strict())
      .optional(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type BriefingItem = z.infer<typeof briefingItemSchema>;

/** Run header emitted as part of the latest/detail response. */
export const briefingRunSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    trigger: briefingTriggerSchema,
    status: briefingRunStatusSchema,
    inputs: z.record(z.string(), z.unknown()),
    steps: z.array(briefingStepRecordSchema),
    costTotal: z.number().nonnegative(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
  })
  .strict();
export type BriefingRun = z.infer<typeof briefingRunSchema>;

export const briefingRunDetailSchema = briefingRunSchema
  .extend({ items: z.array(briefingItemSchema) })
  .strict();
export type BriefingRunDetail = z.infer<typeof briefingRunDetailSchema>;

/** Wire response for GET /v1/briefings/latest. */
export const briefingLatestResponseSchema = briefingRunDetailSchema;
export type BriefingLatestResponse = z.infer<typeof briefingLatestResponseSchema>;

export const runManualBriefingRequestSchema = z
  .object({ trigger: z.literal('manual') })
  .strict();
export type RunManualBriefingRequest = z.infer<typeof runManualBriefingRequestSchema>;

export const editBriefingItemRequestSchema = z
  .object({ payload: z.record(z.string(), z.unknown()) })
  .strict();
export type EditBriefingItemRequest = z.infer<typeof editBriefingItemRequestSchema>;