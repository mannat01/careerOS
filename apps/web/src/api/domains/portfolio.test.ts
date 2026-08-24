import { describe, expect, it } from 'vitest';
import {
  portfolioGenerateResponseSchema,
  portfolioPublishResponseSchema,
  portfolioPublishTokenResponseSchema,
  portfolioResponseSchema,
  publicPortfolioResponseSchema,
} from '@careeros/contracts';
import type { z } from 'zod';
import { unsafe_brandApprovalToken, type GreenAction, type YellowAction } from '../approval';
import type { ApiClient, RequestOptions } from '../client';
import { createPortfolioApi } from './portfolio';

type Call = {
  readonly method: 'get' | 'postGreen' | 'postYellow';
  readonly action?: GreenAction | YellowAction | null;
  readonly path: string;
  readonly body?: unknown;
  readonly schema: z.ZodType<unknown>;
  readonly token?: string;
  readonly opts?: RequestOptions;
};

function clientDouble(): { readonly client: ApiClient; readonly calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      get: <T>(path: string, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> => {
        calls.push({ method: 'get', path, schema, opts });
        return Promise.resolve({} as T);
      },
      postGreen: <T>(action: GreenAction | null, path: string, body: unknown, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> => {
        calls.push({ method: 'postGreen', action, path, body, schema, opts });
        return Promise.resolve({} as T);
      },
      postYellow: <T>(action: YellowAction, path: string, body: unknown, schema: z.ZodType<T>, token: string, opts?: RequestOptions): Promise<T> => {
        calls.push({ method: 'postYellow', action, path, body, schema, token, opts });
        return Promise.resolve({} as T);
      },
      patch: <T>(): Promise<T> => Promise.reject(new Error('Portfolio does not PATCH.')),
      del: <T>(): Promise<T> => Promise.reject(new Error('Portfolio does not DELETE.')),
    },
  };
}

describe('typed portfolio domain', () => {
  it('shape-verifies owner, generate, mint, Yellow publish, and public reads with shared contracts', async () => {
    const { client, calls } = clientDouble();
    const portfolio = createPortfolioApi(client);
    const token = unsafe_brandApprovalToken('single-use-token');

    await portfolio.getOwner();
    await portfolio.generate();
    await portfolio.mintPublishToken();
    await portfolio.publish(token);
    await portfolio.getPublic('owner/slug');

    expect(calls).toEqual([
      { method: 'get', path: '/v1/portfolio', schema: portfolioResponseSchema, opts: undefined },
      { method: 'postGreen', action: null, path: '/v1/portfolio', body: {}, schema: portfolioGenerateResponseSchema, opts: undefined },
      { method: 'postGreen', action: null, path: '/v1/portfolio/publish/mint', body: {}, schema: portfolioPublishTokenResponseSchema, opts: undefined },
      { method: 'postYellow', action: 'portfolio.publish', path: '/v1/portfolio/publish', body: {}, schema: portfolioPublishResponseSchema, token, opts: undefined },
      { method: 'get', path: '/v1/portfolio/public/owner%2Fslug', schema: publicPortfolioResponseSchema, opts: undefined },
    ]);
  });

  it('exposes no unpublish or client-authored-content method', () => {
    const portfolio = createPortfolioApi(clientDouble().client);
    expect(Object.keys(portfolio)).toEqual(['getOwner', 'generate', 'mintPublishToken', 'publish', 'getPublic']);
    expect(portfolio).not.toHaveProperty('unpublish');
    expect(portfolio).not.toHaveProperty('saveContent');
  });
});