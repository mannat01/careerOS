import { describe, expect, it } from 'vitest';
import {
  resumeModelSchema,
  resumeVariantSchema,
} from '@careeros/contracts';
import type { z } from 'zod';
import type { GreenAction, YellowAction } from '../approval';
import type { ApiClient, RequestOptions } from '../client';
import { createResumesApi } from './resumes';

interface Call {
  method: 'get' | 'postGreen';
  path: string;
  schema: z.ZodType<unknown>;
  body?: unknown;
  action?: GreenAction | null;
  opts?: RequestOptions;
}

function clientDouble(): { client: ApiClient; calls: Call[] } {
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
      postYellow: <T>(_action: YellowAction): Promise<T> => Promise.reject(new Error('Résumé tailoring must never be Yellow.')),
      patch: <T>(): Promise<T> => Promise.reject(new Error('not used')),
      del: <T>(): Promise<T> => Promise.reject(new Error('not used')),
    },
  };
}

describe('typed Green résumé domain', () => {
  it('shape-verifies the base model with the exported contract', async () => {
    const { client, calls } = clientDouble();
    await createResumesApi(client).getBase();
    expect(calls).toEqual([{ method: 'get', path: '/v1/cie/resumes/base', schema: resumeModelSchema, opts: undefined }]);
  });

  it('accepts only the contract tailor request and shape-verifies the draft', async () => {
    const { client, calls } = clientDouble();
    const opportunityId = '00000000-0000-4000-8000-000000000022';
    await createResumesApi(client).tailor('base/id', { opportunityId });
    expect(calls).toEqual([{
      method: 'postGreen',
      action: null,
      path: '/v1/cie/resumes/base%2Fid/tailor',
      body: { opportunityId },
      schema: resumeVariantSchema,
      opts: undefined,
    }]);
    expect(() => createResumesApi(client).tailor('base', { opportunityId: 'not-a-uuid' })).toThrow();
  });

  it('shape-verifies retrieved variants with the same exported contract', async () => {
    const { client, calls } = clientDouble();
    await createResumesApi(client).getVariant('variant/id');
    expect(calls).toEqual([{
      method: 'get',
      path: '/v1/cie/resumes/variants/variant%2Fid',
      schema: resumeVariantSchema,
      opts: undefined,
    }]);
  });
});