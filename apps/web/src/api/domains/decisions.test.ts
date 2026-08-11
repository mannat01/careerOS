import { describe, expect, it } from 'vitest';
import { decisionSupportResponseSchema } from '@careeros/contracts';
import type { z } from 'zod';
import type { GreenAction, YellowAction } from '../approval';
import type { ApiClient, RequestOptions } from '../client';
import { createDecisionsApi } from './decisions';

describe('typed advisory decisions domain', () => {
  it('POSTs the exact opportunity context as Green and shape-verifies the response', async () => {
    const calls: Array<{ action: GreenAction | null; path: string; body: unknown; schema: z.ZodType<unknown>; opts?: RequestOptions }> = [];
    const client: ApiClient = {
      get: <T>(): Promise<T> => Promise.reject(new Error('not used')),
      postGreen: <T>(action: GreenAction | null, path: string, body: unknown, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> => {
        calls.push({ action, path, body, schema, opts });
        return Promise.resolve({} as T);
      },
      postYellow: <T>(_action: YellowAction): Promise<T> => Promise.reject(new Error('decision must never be Yellow or act')),
      patch: <T>(): Promise<T> => Promise.reject(new Error('not used')),
      del: <T>(): Promise<T> => Promise.reject(new Error('not used')),
    };

    await createDecisionsApi(client).decide('opportunity-1');

    expect(calls).toEqual([{
      action: null,
      path: '/v1/cie/decide',
      body: { question: 'Should I apply?', context: 'opportunity-1' },
      schema: decisionSupportResponseSchema,
      opts: undefined,
    }]);
  });
});