import { z } from 'zod';

export const auditActorSchema = z.enum(['user', 'twin', 'system']);
export type AuditActor = z.infer<typeof auditActorSchema>;

/** One immutable row emitted by GET /v1/audit. */
export const auditEntrySchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    actor: auditActorSchema,
    action: z.string().min(1),
    target: z.string().nullable(),
    reason: z.string(),
    modelVersion: z.string().nullable(),
    traceId: z.string().nullable(),
    at: z.string().datetime(),
  })
  .strict();
export type AuditEntry = z.infer<typeof auditEntrySchema>;

/** Wire envelope for GET /v1/audit. */
export const auditListResponseSchema = z
  .object({
    data: z.array(auditEntrySchema),
    nextBefore: z.string().datetime().nullable(),
  })
  .strict();
export type AuditListResponse = z.infer<typeof auditListResponseSchema>;