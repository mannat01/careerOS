import { z } from 'zod';

/** Public prep request. The sanctioned opportunity/JD is resolved server-side. */
export const interviewPrepRequestSchema = z
  .object({
    opportunityId: z.string().uuid(),
  })
  .strict();
export type InterviewPrepRequest = z.infer<typeof interviewPrepRequestSchema>;

export const interviewQuestionKindSchema = z.enum([
  'behavioral',
  'technical',
  'system_design',
  'situational',
  'values_fit',
]);
export type InterviewQuestionKind = z.infer<typeof interviewQuestionKindSchema>;

export const interviewEvidenceSchema = z
  .object({
    claim: z.string().min(1),
    /** A real caller-owned profile-fact reference. */
    factRef: z.string().min(1),
  })
  .strict();
export type InterviewEvidence = z.infer<typeof interviewEvidenceSchema>;

export const interviewHonestGapSchema = z
  .object({
    strategy: z.enum(['honest_bridge', 'address_gap']),
    competency: z.string().min(1),
    note: z.string().min(1),
  })
  .strict();
export type InterviewHonestGap = z.infer<typeof interviewHonestGapSchema>;

/**
 * One post-guardrail practice item. Opportunity grounding and profile grounding
 * are co-located so neither the question nor its suggested framing can be
 * rendered without showing the evidence the guarded service actually used.
 */
export const interviewPracticeQuestionSchema = z
  .object({
    id: z.string().min(1),
    kind: interviewQuestionKindSchema,
    prompt: z.string().min(1),
    grounding: z
      .object({
        opportunityId: z.string().uuid(),
        /** Exact requirements from the stored, sanitized opportunity. */
        requirements: z.array(z.string().min(1)).min(1),
        /** Real profile-fact refs backing the answer framing. */
        profileFactRefs: z.array(z.string().min(1)),
      })
      .strict(),
    suggestedAnswer: z
      .object({
        framing: z.string().min(1),
        evidence: z.array(interviewEvidenceSchema),
        honestGap: interviewHonestGapSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type InterviewPracticeQuestion = z.infer<typeof interviewPracticeQuestionSchema>;

const readyInterviewPrepResponseSchema = z
  .object({
    status: z.literal('ready'),
    opportunityId: z.string().uuid(),
    questions: z.array(interviewPracticeQuestionSchema).min(1),
    modelVersion: z.string().min(1),
  })
  .strict();

const insufficientInterviewPrepResponseSchema = z
  .object({
    status: z.literal('insufficient_data'),
    opportunityId: z.string().uuid(),
    reason: z.string().min(1),
    modelVersion: z.string().min(1),
  })
  .strict();

/** POST /v1/cie/interview/prep — grounded output or an honest thin-data result. */
export const interviewPrepResponseSchema = z.discriminatedUnion('status', [
  readyInterviewPrepResponseSchema,
  insufficientInterviewPrepResponseSchema,
]);
export type InterviewPrepResponse = z.infer<typeof interviewPrepResponseSchema>;