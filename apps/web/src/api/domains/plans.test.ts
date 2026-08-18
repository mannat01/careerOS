import { describe, expect, it } from 'vitest';
import { planSetResponseSchema } from '@careeros/contracts';
import type { z } from 'zod';
import type { GreenAction, YellowAction } from '../approval';
import type { ApiClient, RequestOptions } from '../client';
import { createPlansApi } from './plans';

interface GetCall {
  readonly path: string;
  readonly schema: z.ZodType<unknown>;
  readonly opts?: RequestOptions;
}

function clientDouble(): { readonly client: ApiClient; readonly calls: GetCall[] } {
  const calls: GetCall[] = [];
  return {
    calls,
    client: {
      get: <T>(path: string, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> => {
        calls.push({ path, schema, opts });
        return Promise.resolve({} as T);
      },
      postGreen: <T>(_action: GreenAction | null): Promise<T> => Promise.reject(new Error('Plan must not POST.')),
      postYellow: <T>(_action: YellowAction): Promise<T> => Promise.reject(new Error('Plan must not execute Yellow actions.')),
      patch: <T>(): Promise<T> => Promise.reject(new Error('Plan must not mutate actions.')),
      del: <T>(): Promise<T> => Promise.reject(new Error('Plan must not delete.')),
    },
  };
}

describe('typed read-only plans domain', () => {
  it('shape-verifies GET /v1/cie/plans with the shared public schema', async () => {
    const { client, calls } = clientDouble();
    await createPlansApi(client).get();

    expect(calls).toEqual([{ path: '/v1/cie/plans', schema: planSetResponseSchema, opts: undefined }]);
  });

  it('exposes no generation, mutation, approval, or execution client call', () => {
    expect(Object.keys(createPlansApi(clientDouble().client))).toEqual(['get']);
  });
});