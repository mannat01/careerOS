import { z } from 'zod';

/** The fixed Career State Model dimension vocabulary emitted by the state service. */
export const cieDimensionKeySchema = z.enum([
  'career_goals',
  'interests',
  'strengths',
  'weaknesses',
  'demonstrated_skills',
  'inferred_skills',
  'learning_velocity',
  'preferred_industries',
  'preferred_company_sizes',
  'compensation_goals',
  'geographic_preferences',
  'work_style_preferences',
  'values',
  'leadership_readiness',
  'communication_style',
]);
export type CieDimensionKey = z.infer<typeof cieDimensionKeySchema>;

/** Labels produced by `CareerStateService.provenanceLabel`. */
export const cieProvenanceSchema = z.enum(['no-signal', 'demonstrated', 'inferred', 'summarized']);
export type CieProvenance = z.infer<typeof cieProvenanceSchema>;

export const cieStateDimensionSchema = z
  .object({
    dimension: cieDimensionKeySchema,
    value: z.strictObject({ values: z.array(z.string()) }),
    confidence: z.number().min(0).max(1),
    provenance: cieProvenanceSchema,
    evidenceRefs: z.array(z.string()),
    freshnessAt: z.string().datetime(),
    modelVersion: z.string().min(1),
  })
  .strict();
export type CieStateDimension = z.infer<typeof cieStateDimensionSchema>;

/** Wire response for GET /v1/cie/state. */
export const cieStateResponseSchema = z
  .object({
    profileId: z.string().min(1),
    version: z.number().int().nonnegative(),
    updatedAt: z.string().datetime(),
    dimensions: z.array(cieStateDimensionSchema),
  })
  .strict();
export type CieStateResponse = z.infer<typeof cieStateResponseSchema>;

export const cieStateExplainEvidenceSchema = z
  .object({
    ref: z.string(),
    kind: z.string(),
    label: z.string(),
  })
  .strict();

/** Wire response for the companion explain endpoint. */
export const cieStateExplainResponseSchema = z
  .object({
    dimension: z.string().min(1),
    values: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    provenance: cieProvenanceSchema,
    reasoning: z.string(),
    evidence: z.array(cieStateExplainEvidenceSchema),
  })
  .strict();
export type CieStateExplainResponse = z.infer<typeof cieStateExplainResponseSchema>;