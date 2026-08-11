import { z } from 'zod';

/** Exact FM3.2 request body for an opportunity-scoped advisory decision. */
export const decisionSupportRequestSchema = z
  .object({
    question: z.string().trim().min(1),
    context: z.string().trim().min(1),
  })
  .strict();
export type DecisionSupportRequest = z.infer<typeof decisionSupportRequestSchema>;

/**
 * Public wire contract for POST /v1/cie/decide.
 *
 * Strings and arrays may honestly be empty when a fake/thin model has no
 * grounded signal. The UI must render those cases as InsufficientData rather
 * than weakening this boundary or inventing replacement content.
 */
export const decisionSupportResponseSchema = z
  .object({
    alternatives: z.array(z.string()),
    evidenceRefs: z.array(z.string()),
    reasoning: z.string(),
    confidence: z.number().min(0).max(1),
    assumptions: z.array(z.string()),
    recommendation: z.string(),
    optionalityNote: z.string().optional(),
    modelVersion: z.string().min(1).optional(),
  })
  .strict();
export type DecisionSupportResponse = z.infer<typeof decisionSupportResponseSchema>;