import { z } from 'zod';
import type { ApprovalToken } from '@careeros/capability-gate';

/** Runtime validator whose inferred output reuses the capability-gate's opaque brand. */
export const approvalTokenSchema = z.custom<ApprovalToken>(
  (value) => typeof value === 'string' && value.length > 0,
  'Expected a non-empty ApprovalToken',
);

export const approvalResourceRefSchema = z
  .object({
    type: z.string().min(1),
    id: z.string().min(1),
  })
  .strict();
export type ApprovalResourceRef = z.infer<typeof approvalResourceRefSchema>;

export const approvalLifecycleStateSchema = z.enum([
  'proposed',
  'approved',
  'executed',
  'denied',
]);
export type ApprovalLifecycleState = z.infer<typeof approvalLifecycleStateSchema>;

export const pendingApprovalSchema = z
  .object({
    id: z.string().min(1),
    action: z.string().min(1),
    why: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
    tier: z.literal('yellow'),
    resourceRefs: z.array(approvalResourceRefSchema),
    state: z.enum(['proposed', 'approved']),
    createdAt: z.string().datetime(),
  })
  .strict();
export type PendingApproval = z.infer<typeof pendingApprovalSchema>;

export const pendingApprovalListResponseSchema = z
  .object({ data: z.array(pendingApprovalSchema) })
  .strict();
export type PendingApprovalListResponse = z.infer<typeof pendingApprovalListResponseSchema>;

export const approvalMintRequestSchema = z
  .object({
    approvalId: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ApprovalMintRequest = z.infer<typeof approvalMintRequestSchema>;

export const approvalMintResponseSchema = z
  .object({
    token: approvalTokenSchema,
    expiresAt: z.string().datetime(),
    action: z.string().min(1),
    payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type ApprovalMintResponse = z.infer<typeof approvalMintResponseSchema>;

export const approvalEditRequestSchema = approvalMintRequestSchema;
export type ApprovalEditRequest = z.infer<typeof approvalEditRequestSchema>;

export const approvalEditResponseSchema = z
  .object({
    approvalId: z.string().min(1),
    state: z.literal('proposed'),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ApprovalEditResponse = z.infer<typeof approvalEditResponseSchema>;

export const approvalExecuteRequestSchema = z
  .object({
    token: approvalTokenSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ApprovalExecuteRequest = z.infer<typeof approvalExecuteRequestSchema>;

export const approvalExecuteResponseSchema = z
  .object({
    approvalId: z.string().min(1),
    action: z.string().min(1),
    state: z.literal('executed'),
    outcome: z.string().min(1),
    executedAt: z.string().datetime(),
  })
  .strict();
export type ApprovalExecuteResponse = z.infer<typeof approvalExecuteResponseSchema>;

export const approvalDenyRequestSchema = z
  .object({
    approvalId: z.string().min(1),
    reason: z.string().trim().min(1),
  })
  .strict();
export type ApprovalDenyRequest = z.infer<typeof approvalDenyRequestSchema>;

export const approvalDenyResponseSchema = z
  .object({
    approvalId: z.string().min(1),
    state: z.literal('denied'),
    deniedAt: z.string().datetime(),
  })
  .strict();
export type ApprovalDenyResponse = z.infer<typeof approvalDenyResponseSchema>;