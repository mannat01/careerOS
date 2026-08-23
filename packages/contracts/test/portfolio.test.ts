import { describe, expect, it } from 'vitest';
import {
  portfolioContentSchema,
  portfolioGenerateRequestSchema,
  portfolioGenerateResponseSchema,
  portfolioPublishRequestSchema,
  portfolioPublishResponseSchema,
  portfolioPublishTokenResponseSchema,
  portfolioResponseSchema,
  publicPortfolioResponseSchema,
} from '../src/index.js';

const CONTENT = {
  status: 'ready' as const,
  headline: { text: 'Senior Engineer', factRefs: ['experience:1'] },
  summary: { text: 'Builds reliable platforms.', factRefs: ['experience:1'] },
  projects: [{
    title: 'Payments API',
    description: 'A caller-recorded payments project.',
    skills: ['TypeScript'],
    factRefs: ['project:1'],
  }],
  skills: [{ skill: 'TypeScript', factRefs: ['skill:1'] }],
  modelVersion: 'portfolio@1.0.0',
};
const PUBLISHED_AT = '2026-08-23T12:00:00.000Z';

describe('FM6.6-pre public portfolio contracts', () => {
  it('strictly parses grounded content with provenance and no confidence', () => {
    expect(portfolioContentSchema.parse(CONTENT)).toEqual(CONTENT);
    expect(portfolioContentSchema.safeParse({ ...CONTENT, confidence: 0.9 }).success).toBe(false);
    expect(portfolioContentSchema.safeParse({
      ...CONTENT,
      projects: [{ ...CONTENT.projects[0], factRefs: [] }],
    }).success).toBe(false);
    expect(portfolioContentSchema.safeParse({
      ...CONTENT,
      headline: { text: 'Ungrounded headline', factRefs: [] },
    }).success).toBe(false);
  });

  it('preserves an explicit insufficient-data content result', () => {
    const thin = {
      status: 'insufficient_data' as const,
      reason: 'No grounded portfolio claims are available yet.',
      modelVersion: 'portfolio@1.0.0',
    };
    expect(portfolioContentSchema.parse(thin)).toEqual(thin);
    expect(portfolioContentSchema.safeParse({ ...thin, projects: [] }).success).toBe(false);
  });

  it('accepts no body or an exact empty body for generate and publish', () => {
    expect(portfolioGenerateRequestSchema.parse(undefined)).toEqual({});
    expect(portfolioGenerateRequestSchema.parse({})).toEqual({});
    expect(portfolioPublishRequestSchema.parse(undefined)).toEqual({});
    expect(portfolioPublishRequestSchema.safeParse({ content: CONTENT }).success).toBe(false);
  });

  it('strictly separates owner state from the public frozen-snapshot shape', () => {
    const owner = {
      content: CONTENT,
      publishStatus: 'private' as const,
      slug: 'senior-engineer',
      publishedAt: null,
      hasPublishedSnapshot: false,
    };
    expect(portfolioResponseSchema.parse(owner)).toEqual(owner);
    expect(portfolioGenerateResponseSchema.parse(owner)).toEqual(owner);
    expect(portfolioResponseSchema.safeParse({ ...owner, userId: 'private-user' }).success).toBe(false);
    expect(portfolioResponseSchema.safeParse({ ...owner, publishedAt: PUBLISHED_AT }).success).toBe(false);

    const publicView = { slug: owner.slug, content: CONTENT, publishedAt: PUBLISHED_AT };
    expect(publicPortfolioResponseSchema.parse(publicView)).toEqual(publicView);
    expect(publicPortfolioResponseSchema.safeParse({ ...publicView, draft: CONTENT }).success).toBe(false);
    expect(publicPortfolioResponseSchema.safeParse({
      ...publicView,
      content: { status: 'insufficient_data', reason: 'Thin.', modelVersion: 'portfolio@1.0.0' },
    }).success).toBe(false);
  });

  it('strictly parses publish and token-mint responses', () => {
    const published = {
      content: CONTENT,
      publishStatus: 'published' as const,
      slug: 'senior-engineer',
      publishedAt: PUBLISHED_AT,
      hasPublishedSnapshot: true as const,
    };
    expect(portfolioPublishResponseSchema.parse(published)).toEqual(published);
    expect(portfolioPublishResponseSchema.safeParse({ ...published, hasPublishedSnapshot: false }).success).toBe(false);

    const grant = {
      token: 'single-use-token',
      expiresAt: PUBLISHED_AT,
      action: 'portfolio.publish' as const,
      payloadHash: 'a'.repeat(64),
      slug: published.slug,
      content: CONTENT,
    };
    expect(portfolioPublishTokenResponseSchema.parse(grant)).toEqual(grant);
    expect(portfolioPublishTokenResponseSchema.safeParse({ ...grant, action: 'draft.send' }).success).toBe(false);
  });
});