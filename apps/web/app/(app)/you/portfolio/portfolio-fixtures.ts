import {
  portfolioPublishResponseSchema,
  portfolioPublishTokenResponseSchema,
  portfolioResponseSchema,
  publicPortfolioResponseSchema,
  type PortfolioPublishResponse,
  type PortfolioPublishTokenResponse,
  type PortfolioResponse,
  type PublicPortfolioResponse,
} from '@careeros/contracts';

export const PORTFOLIO_SLUG = 'alex-rivera';
export const PUBLISHED_AT = '2026-08-23T12:00:00.000Z';

export const GROUNDED_PORTFOLIO: PortfolioResponse = portfolioResponseSchema.parse({
  content: {
    status: 'ready',
    headline: { text: 'Senior platform engineer', factRefs: ['experience:acme'] },
    summary: { text: 'Builds reliable developer platforms.', factRefs: ['experience:acme'] },
    projects: [{
      title: 'Deployment Safety Platform',
      description: 'A caller-recorded platform project.',
      skills: ['TypeScript', 'Kubernetes'],
      factRefs: ['project:deploy-safety'],
    }],
    skills: [
      { skill: 'TypeScript', factRefs: ['skill:typescript'] },
      { skill: 'Kubernetes', factRefs: ['graph:kubernetes'] },
    ],
    modelVersion: 'portfolio@fake-grounded',
  },
  publishStatus: 'private',
  slug: PORTFOLIO_SLUG,
  publishedAt: null,
  hasPublishedSnapshot: false,
});

export const UPDATED_PORTFOLIO: PortfolioResponse = portfolioResponseSchema.parse({
  ...GROUNDED_PORTFOLIO,
  content: GROUNDED_PORTFOLIO.content.status === 'ready' ? {
    ...GROUNDED_PORTFOLIO.content,
    headline: { text: 'Updated platform engineer', factRefs: ['experience:acme'] },
  } : GROUNDED_PORTFOLIO.content,
});

export const INSUFFICIENT_PORTFOLIO: PortfolioResponse = portfolioResponseSchema.parse({
  content: {
    status: 'insufficient_data',
    reason: 'No grounded portfolio claims are available yet.',
    modelVersion: 'portfolio@fake-grounded',
  },
  publishStatus: 'private',
  slug: 'thin-profile',
  publishedAt: null,
  hasPublishedSnapshot: false,
});

export const PUBLISH_GRANT: PortfolioPublishTokenResponse = portfolioPublishTokenResponseSchema.parse({
  token: 'portfolio-single-use-token',
  expiresAt: '2026-08-23T12:15:00.000Z',
  action: 'portfolio.publish',
  payloadHash: 'a'.repeat(64),
  slug: PORTFOLIO_SLUG,
  content: GROUNDED_PORTFOLIO.content,
});

export const PUBLISHED_PORTFOLIO: PortfolioPublishResponse = portfolioPublishResponseSchema.parse({
  content: PUBLISH_GRANT.content,
  publishStatus: 'published',
  slug: PORTFOLIO_SLUG,
  publishedAt: PUBLISHED_AT,
  hasPublishedSnapshot: true,
});

export const PUBLIC_PORTFOLIO: PublicPortfolioResponse = publicPortfolioResponseSchema.parse({
  slug: PORTFOLIO_SLUG,
  content: PUBLISH_GRANT.content,
  publishedAt: PUBLISHED_AT,
});