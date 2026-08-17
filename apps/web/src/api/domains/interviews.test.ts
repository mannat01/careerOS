import { describe, expect, it } from 'vitest';
import {
  interviewPrepResponseSchema,
} from '@careeros/contracts';
import type { z } from 'zod';
import type { GreenAction, YellowAction } from '../approval';
import type { ApiClient, RequestOptions } from '../client';
import { createInterviewsApi } from './interviews';

interface Call {
  readonly action: GreenAction | null;
  readonly path: string;
  readonly body: unknown;
  readonly schema: z.ZodType<unknown>;
  readonly opts?: RequestOptions;
}

function clientDouble(): { readonly client: ApiClient; readonly calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      get: <T>(): Promise<T> => Promise.reject(new Error('not used')),
      postGreen: <T>(action: GreenAction | null, path: string, body: unknown, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> => {
        calls.push({ action, path, body, schema, opts });
        return Promise.resolve({} as T);
      },
      postYellow: <T>(_action: YellowAction): Promise<T> => Promise.reject(new Error('Interview prep must never be Yellow.')),
      patch: <T>(): Promise<T> => Promise.reject(new Error('not used')),
      del: <T>(): Promise<T> => Promise.reject(new Error('not used')),
    },
  };
}

describe('typed Green interview-prep domain', () => {
  it('parses the request and shape-verifies the grounded response', async () => {
    const { client, calls } = clientDouble();
    const opportunityId = '00000000-0000-4000-8000-000000000061';
    await createInterviewsApi(client).prepare({ opportunityId });
    expect(calls).toEqual([{
      action: null,
      path: '/v1/cie/interview/prep',
      body: { opportunityId },
      schema: interviewPrepResponseSchema,
      opts: undefined,
    }]);
  });

  it('rejects a non-contract request before transport', () => {
    const { client } = clientDouble();
    expect(() => createInterviewsApi(client).prepare({ opportunityId: 'not-a-uuid' })).toThrow();
  });
});