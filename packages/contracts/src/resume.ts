import { z } from 'zod';

/** One ordered, real profile-fact reference in the structured base résumé. */
export const resumeSelectedItemSchema = z
  .object({
    factId: z.string().min(1),
    order: z.number().int().nonnegative(),
    phrasing: z.string().min(1).optional(),
  })
  .strict();
export type ResumeSelectedItem = z.infer<typeof resumeSelectedItemSchema>;

/** GET /v1/cie/resumes/base — structured model derived from real profile facts. */
export const resumeModelSchema = z
  .object({
    id: z.string().min(1),
    profileId: z.string().min(1),
    name: z.string().min(1),
    selectedItems: z.array(resumeSelectedItemSchema).min(1),
    base: z.literal(true),
  })
  .strict();
export type ResumeModel = z.infer<typeof resumeModelSchema>;

/** Public tailor request. Job text is resolved server-side from the opportunity. */
export const resumeTailorRequestSchema = z
  .object({
    opportunityId: z.string().uuid(),
  })
  .strict();
export type ResumeTailorRequest = z.infer<typeof resumeTailorRequestSchema>;

export const resumeTailoredBulletSchema = z
  .object({
    text: z.string().min(1),
    factId: z.string().min(1),
  })
  .strict();
export type ResumeTailoredBullet = z.infer<typeof resumeTailoredBulletSchema>;

export const resumeDiffSchema = z
  .object({
    selected: z.array(z.string().min(1)),
    dropped: z.array(z.string().min(1)),
    rephrased: z.array(z
      .object({
        factId: z.string().min(1),
        from: z.string(),
        to: z.string(),
      })
      .strict()),
  })
  .strict();
export type ResumeDiff = z.infer<typeof resumeDiffSchema>;

export const resumeAtsCheckSchema = z
  .object({
    passed: z.boolean(),
    warnings: z.array(z.string().min(1)),
  })
  .strict();
export type ResumeAtsCheck = z.infer<typeof resumeAtsCheckSchema>;

/** Tailor response and GET /v1/cie/resumes/variants/:id response. */
export const resumeVariantSchema = z
  .object({
    id: z.string().min(1),
    resumeModelId: z.string().min(1),
    opportunityId: z.string().min(1),
    bullets: z.array(resumeTailoredBulletSchema),
    rendered: z.string(),
    diff: resumeDiffSchema,
    rationale: z.string(),
    atsCheck: resumeAtsCheckSchema,
    modelVersion: z.string().min(1),
  })
  .strict();
export type ResumeVariant = z.infer<typeof resumeVariantSchema>;