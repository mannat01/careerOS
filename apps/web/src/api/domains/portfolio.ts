/** Contract-verified Portfolio API. Grounded content carries provenance, never confidence. */
import {
  portfolioGenerateRequestSchema,
  portfolioGenerateResponseSchema,
  portfolioPublishRequestSchema,
  portfolioPublishResponseSchema,
  portfolioPublishTokenRequestSchema,
  portfolioPublishTokenResponseSchema,
  portfolioResponseSchema,
  publicPortfolioResponseSchema,
  type PortfolioGenerateRequest,
  type PortfolioGenerateResponse,
  type PortfolioPublishRequest,
  type PortfolioPublishResponse,
  type PortfolioPublishTokenRequest,
  type PortfolioPublishTokenResponse,
  type PortfolioResponse,
  type PublicPortfolioResponse,
} from '@careeros/contracts';
import type { ApprovalToken } from '../approval';
import type { ApiClient, RequestOptions } from '../client';

export interface PortfolioApi {
  getOwner(opts?: RequestOptions): Promise<PortfolioResponse>;
  generate(body?: PortfolioGenerateRequest, opts?: RequestOptions): Promise<PortfolioGenerateResponse>;
  mintPublishToken(body?: PortfolioPublishTokenRequest, opts?: RequestOptions): Promise<PortfolioPublishTokenResponse>;
  publish(
    token: ApprovalToken,
    body?: PortfolioPublishRequest,
    opts?: RequestOptions,
  ): Promise<PortfolioPublishResponse>;
  getPublic(slug: string, opts?: RequestOptions): Promise<PublicPortfolioResponse>;
}

export function createPortfolioApi(client: ApiClient): PortfolioApi {
  return {
    getOwner: (opts) => client.get('/v1/portfolio', portfolioResponseSchema, opts),
    generate: (body, opts) => client.postGreen(
      null,
      '/v1/portfolio',
      portfolioGenerateRequestSchema.parse(body),
      portfolioGenerateResponseSchema,
      opts,
    ),
    mintPublishToken: (body, opts) => client.postGreen(
      null,
      '/v1/portfolio/publish/mint',
      portfolioPublishTokenRequestSchema.parse(body),
      portfolioPublishTokenResponseSchema,
      opts,
    ),
    publish: (token, body, opts) => client.postYellow(
      'portfolio.publish',
      '/v1/portfolio/publish',
      portfolioPublishRequestSchema.parse(body),
      portfolioPublishResponseSchema,
      token,
      opts,
    ),
    getPublic: (slug, opts) => client.get(
      `/v1/portfolio/public/${encodeURIComponent(slug)}`,
      publicPortfolioResponseSchema,
      opts,
    ),
  };
}