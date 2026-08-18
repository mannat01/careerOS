import { z } from 'zod';

/** Public planning horizons, ordered by the planner from near- to long-term. */
export const planHorizonSchema = z.enum(['30d', '90d', '1y', '3y', '5y']);
export type PlanHorizon = z.infer<typeof planHorizonSchema>;

export const planActionKindSchema = z.enum([
  'skill',
  'project',
  'cert',
  'role',
  'network',
  'other',
]);
export type PlanActionKind = z.infer<typeof planActionKindSchema>;

export const planActionStatusSchema = z.enum(['suggested', 'in_progress', 'done', 'dropped']);
export type PlanActionStatus = z.infer<typeof planActionStatusSchema>;

/**
 * A persisted, grounded plan action. `evidenceRefs` resolve to real state used
 * by the planner (a stated goal, graph node, and optionally a real gap).
 *
 * This is grounded generation under ADR-004, not a scored inference, so this
 * contract deliberately has no numeric confidence field.
 */
export const planActionResponseSchema = z
  .object({
    id: z.string().min(1),
    kind: planActionKindSchema,
    title: z.string().min(1),
    rationale: z.string(),
    status: planActionStatusSchema,
    progress: z.number().int().min(0).max(100),
    evidenceRefs: z.array(z.string().min(1)),
  })
  .strict();
export type PlanActionResponse = z.infer<typeof planActionResponseSchema>;

/** One active horizon plan projected from persistence into the public API. */
export const planResponseSchema = z
  .object({
    id: z.string().min(1),
    horizon: planHorizonSchema,
    summary: z.string(),
    /** References to goals explicitly stated by the caller. */
    goalRefs: z.array(z.string().min(1)),
    diffSummary: z.string().nullable(),
    rationale: z.string().nullable(),
    modelVersion: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    actions: z.array(planActionResponseSchema),
  })
  .strict();
export type PlanResponse = z.infer<typeof planResponseSchema>;

export const todaysMoveSchema = z
  .object({
    actionId: z.string().min(1),
    horizon: z.literal('30d'),
    title: z.string().min(1),
  })
  .strict();
export type TodaysMove = z.infer<typeof todaysMoveSchema>;

const readyPlanSetResponseSchema = z
  .object({
    status: z.literal('ready'),
    plans: z.array(planResponseSchema).min(1),
    todaysMove: todaysMoveSchema.nullable(),
  })
  .strict();

const insufficientPlanSetResponseSchema = z
  .object({
    status: z.literal('insufficient_data'),
    plans: z.tuple([]),
    todaysMove: z.null(),
    reason: z.string().min(1),
  })
  .strict();

/** GET /v1/cie/plans — grounded active plans or an honest no-plan result. */
export const planSetResponseSchema = z.discriminatedUnion('status', [
  readyPlanSetResponseSchema,
  insufficientPlanSetResponseSchema,
]);
export type PlanSetResponse = z.infer<typeof planSetResponseSchema>;