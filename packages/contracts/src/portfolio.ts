import { z } from 'zod';
import { approvalTokenSchema } from './approval.js';

const factRefSchema = z.string().trim().min(1);

/** Grounded text is either absent or backed by at least one resolvable fact ref. */
export const portfolioGroundedTextSchema = z
  .object({
    text: z.string().trim(),
    factRefs: z.array(factRefSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.text.length > 0 && value.factRefs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Non-empty portfolio text requires provenance factRefs.',
        path: ['factRefs'],
      });
    }
    if (value.text.length === 0 && value.factRefs.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Empty portfolio text cannot claim provenance factRefs.',
        path: ['factRefs'],
      });
    }
  });
export type PortfolioGroundedText = z.infer<typeof portfolioGroundedTextSchema>;

export const portfolioProjectSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    skills: z.array(z.string().trim().min(1)),
    /** Resolvable profile/project/graph references grounding every rendered claim. */
    factRefs: z.array(factRefSchema).min(1),
  })
  .strict();
export type PortfolioProject = z.infer<typeof portfolioProjectSchema>;

export const portfolioSkillSchema = z
  .object({
    skill: z.string().trim().min(1),
    factRefs: z.array(factRefSchema).min(1),
  })
  .strict();
export type PortfolioSkill = z.infer<typeof portfolioSkillSchema>;

const readyPortfolioContentSchema = z
  .object({
    status: z.literal('ready'),
    headline: portfolioGroundedTextSchema,
    summary: portfolioGroundedTextSchema,
    projects: z.array(portfolioProjectSchema),
    skills: z.array(portfolioSkillSchema),
    modelVersion: z.string().trim().min(1),
  })
  .strict()
  .superRefine((content, ctx) => {
    const hasGrounding = content.headline.factRefs.length > 0
      || content.summary.factRefs.length > 0
      || content.projects.length > 0
      || content.skills.length > 0;
    if (!hasGrounding) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A ready portfolio requires at least one grounded claim.',
      });
    }
  });
export type ReadyPortfolioContent = z.infer<typeof readyPortfolioContentSchema>;

const insufficientPortfolioContentSchema = z
  .object({
    status: z.literal('insufficient_data'),
    reason: z.string().trim().min(1),
    modelVersion: z.string().trim().min(1),
  })
  .strict();

/**
 * Grounded generation under ADR-004. Provenance is directly inspectable via
 * factRefs; no numeric confidence is present or permitted. Thin grounding is
 * an explicit result rather than fabricated public copy.
 */
export const portfolioContentSchema = z.union([
  readyPortfolioContentSchema,
  insufficientPortfolioContentSchema,
]);
export type PortfolioContent = z.infer<typeof portfolioContentSchema>;

export const portfolioPublishStatusSchema = z.enum(['private', 'published']);
export type PortfolioPublishStatus = z.infer<typeof portfolioPublishStatusSchema>;

/** Owner-only projection. It contains the current draft, but never the frozen snapshot body. */
export const portfolioResponseSchema = z
  .object({
    content: portfolioContentSchema,
    publishStatus: portfolioPublishStatusSchema,
    slug: z.string().trim().min(1),
    publishedAt: z.string().datetime().nullable(),
    hasPublishedSnapshot: z.boolean(),
  })
  .strict()
  .superRefine((portfolio, ctx) => {
    const published = portfolio.publishStatus === 'published';
    if (published !== portfolio.hasPublishedSnapshot || published !== (portfolio.publishedAt !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Publish status, snapshot presence, and publishedAt must agree.',
        path: ['publishStatus'],
      });
    }
  });
export type PortfolioResponse = z.infer<typeof portfolioResponseSchema>;

/** Public projection: only the immutable published snapshot and its public metadata. */
export const publicPortfolioResponseSchema = z
  .object({
    slug: z.string().trim().min(1),
    content: readyPortfolioContentSchema,
    publishedAt: z.string().datetime(),
  })
  .strict();
export type PublicPortfolioResponse = z.infer<typeof publicPortfolioResponseSchema>;

const noBodyRequestSchema = z.object({}).strict().optional().transform(() => ({}));

/** POST /v1/portfolio accepts either no JSON body or an exact empty object. */
export const portfolioGenerateRequestSchema = noBodyRequestSchema;
export type PortfolioGenerateRequest = z.infer<typeof portfolioGenerateRequestSchema>;
export const portfolioGenerateResponseSchema = portfolioResponseSchema;
export type PortfolioGenerateResponse = z.infer<typeof portfolioGenerateResponseSchema>;

/** POST /v1/portfolio/publish accepts no client-authored content; the server reloads the draft. */
export const portfolioPublishRequestSchema = noBodyRequestSchema;
export type PortfolioPublishRequest = z.infer<typeof portfolioPublishRequestSchema>;

export const portfolioPublishResponseSchema = z
  .object({
    content: readyPortfolioContentSchema,
    publishStatus: z.literal('published'),
    slug: z.string().trim().min(1),
    publishedAt: z.string().datetime(),
    hasPublishedSnapshot: z.literal(true),
  })
  .strict();
export type PortfolioPublishResponse = z.infer<typeof portfolioPublishResponseSchema>;

/** Green confirmation request: it never accepts content and never requires a token. */
export const portfolioPublishTokenRequestSchema = noBodyRequestSchema;
export type PortfolioPublishTokenRequest = z.infer<typeof portfolioPublishTokenRequestSchema>;

/** Exact public preview plus a single-use token bound to hash(content). */
export const portfolioPublishTokenResponseSchema = z
  .object({
    token: approvalTokenSchema,
    expiresAt: z.string().datetime(),
    action: z.literal('portfolio.publish'),
    payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
    slug: z.string().trim().min(1),
    content: readyPortfolioContentSchema,
  })
  .strict();
export type PortfolioPublishTokenResponse = z.infer<typeof portfolioPublishTokenResponseSchema>;