import { z } from 'zod';

export const draftKindSchema = z.enum(['cover_letter', 'outreach']);
export type DraftKind = z.infer<typeof draftKindSchema>;

export const draftRecipientSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    role: z.string().trim().min(1).optional(),
    channel: z.string().trim().min(1).optional(),
  })
  .strict();
export type DraftRecipient = z.infer<typeof draftRecipientSchema>;

/** Public generation request. The opportunity and its pipeline ownership are resolved server-side. */
export const draftGenerateRequestSchema = z
  .object({
    kind: draftKindSchema,
    opportunityId: z.string().uuid(),
    recipient: draftRecipientSchema.optional(),
  })
  .strict();
export type DraftGenerateRequest = z.infer<typeof draftGenerateRequestSchema>;

export const draftClaimSchema = z
  .object({
    claim: z.string().trim().min(1),
    /** A caller-owned profile-fact or graph-node reference resolved by the drafting guardrail. */
    factRef: z.string().trim().min(1),
  })
  .strict();
export type DraftClaim = z.infer<typeof draftClaimSchema>;

/**
 * A post-guardrail draft. This is grounded generation under ADR-004: claims
 * carry resolvable evidence refs, and no synthetic confidence is permitted.
 */
const groundedDraftResponseSchema = z
  .object({
    id: z.string().uuid(),
    kind: draftKindSchema,
    opportunityId: z.string().uuid(),
    recipient: draftRecipientSchema.nullable(),
    subject: z.string().trim().min(1),
    body: z.string().trim().min(1),
    claims: z.array(draftClaimSchema).min(1),
    modelVersion: z.string().trim().min(1),
    status: z.literal('draft'),
    sentAt: z.null(),
    createdAt: z.string().datetime(),
  })
  .strict();

const insufficientDraftResponseSchema = z
  .object({
    status: z.literal('insufficient_data'),
  })
  .strict();

/** POST /v1/drafts — a grounded draft or an honest thin-grounding result. */
export const draftResponseSchema = z.discriminatedUnion('status', [
  groundedDraftResponseSchema,
  insufficientDraftResponseSchema,
]);
export type DraftResponse = z.infer<typeof draftResponseSchema>;