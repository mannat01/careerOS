import { z } from 'zod';

/** Optional GET /v1/skills/gaps query. The caller identity always comes from auth. */
export const skillGapsQuerySchema = z
  .object({
    opportunityId: z.string().uuid().optional(),
  })
  .strict();
export type SkillGapsQuery = z.infer<typeof skillGapsQuerySchema>;

const opportunityRequirementEvidenceRefSchema = z
  .object({
    kind: z.literal('opportunity_requirement'),
    opportunityId: z.string().uuid(),
    requirement: z.string().trim().min(1),
  })
  .strict();

const matchSubscoreEvidenceRefSchema = z
  .object({
    kind: z.literal('match_subscore'),
    opportunityId: z.string().uuid(),
    key: z.string().trim().min(1),
    value: z.number().min(0).max(100),
  })
  .strict();

const stateDimensionEvidenceRefSchema = z
  .object({
    kind: z.literal('state_dimension'),
    dimension: z.string().trim().min(1),
    signal: z.enum(['weak', 'missing']),
  })
  .strict();

const targetRoleEvidenceRefSchema = z
  .object({
    kind: z.literal('target_role'),
    role: z.string().trim().min(1),
  })
  .strict();

/** A resolvable source used by the deterministic gap derivation. */
export const skillGapEvidenceRefSchema = z.discriminatedUnion('kind', [
  opportunityRequirementEvidenceRefSchema,
  matchSubscoreEvidenceRefSchema,
  stateDimensionEvidenceRefSchema,
  targetRoleEvidenceRefSchema,
]);
export type SkillGapEvidenceRef = z.infer<typeof skillGapEvidenceRefSchema>;

export const skillGapSeveritySchema = z.enum(['low', 'medium', 'high']);
export type SkillGapSeverity = z.infer<typeof skillGapSeveritySchema>;

export const skillGapSourceSchema = z.enum(['per_opp', 'aggregate']);
export type SkillGapSource = z.infer<typeof skillGapSourceSchema>;

const skillGapBaseSchema = z.object({
  id: z.string().uuid(),
  skill: z.string().trim().min(1),
  gap: z.string().trim().min(1),
  severity: skillGapSeveritySchema,
  evidenceRefs: z.array(skillGapEvidenceRefSchema).min(1),
  modelVersion: z.string().trim().min(1),
  computedAt: z.string().datetime(),
});

/**
 * One post-guardrail skill gap. This is grounded generation under ADR-004:
 * provenance is explicit and resolvable, while synthetic confidence is absent.
 */
export const skillGapSchema = z
  .discriminatedUnion('source', [
    skillGapBaseSchema
      .extend({
        source: z.literal('per_opp'),
        opportunityId: z.string().uuid(),
      })
      .strict(),
    skillGapBaseSchema
      .extend({
        source: z.literal('aggregate'),
        opportunityId: z.null(),
      })
      .strict(),
  ])
  .superRefine((gap, ctx) => {
    if (gap.source === 'per_opp') {
      const requirementRefs = gap.evidenceRefs.filter(
        (ref) => ref.kind === 'opportunity_requirement',
      );
      const subscoreRefs = gap.evidenceRefs.filter((ref) => ref.kind === 'match_subscore');
      if (requirementRefs.length === 0 || subscoreRefs.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'A per-opportunity gap requires requirement and match-subscore provenance.',
          path: ['evidenceRefs'],
        });
      }
      if (
        [...requirementRefs, ...subscoreRefs].some(
          (ref) => ref.opportunityId !== gap.opportunityId,
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Per-opportunity evidence must resolve to the gap opportunity.',
          path: ['evidenceRefs'],
        });
      }
      return;
    }

    const hasState = gap.evidenceRefs.some((ref) => ref.kind === 'state_dimension');
    const hasTarget = gap.evidenceRefs.some((ref) => ref.kind === 'target_role');
    const hasOpportunityEvidence = gap.evidenceRefs.some(
      (ref) => ref.kind === 'opportunity_requirement' || ref.kind === 'match_subscore',
    );
    if (!hasState || !hasTarget || hasOpportunityEvidence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An aggregate gap requires state-dimension and target-role provenance only.',
        path: ['evidenceRefs'],
      });
    }
  });
export type SkillGap = z.infer<typeof skillGapSchema>;

const analyzedSkillGapsResponseSchema = z
  .object({
    status: z.literal('ok'),
    /** Empty means the analysis completed and found no gaps. */
    gaps: z.array(skillGapSchema),
  })
  .strict();

const insufficientSkillGapsResponseSchema = z
  .object({
    status: z.literal('insufficient_data'),
  })
  .strict();

/** GET /v1/skills/gaps — analyzed gaps or an honest thin-profile result. */
export const skillGapsResponseSchema = z.discriminatedUnion('status', [
  analyzedSkillGapsResponseSchema,
  insufficientSkillGapsResponseSchema,
]);
export type SkillGapsResponse = z.infer<typeof skillGapsResponseSchema>;