import { describe, expect, it } from 'vitest';
import {
  cieStateExplainResponseSchema,
  cieStateResponseSchema,
} from '@careeros/contracts';
import type { z } from 'zod';
import type { GreenAction, YellowAction } from '../approval';
import type { ApiClient, RequestOptions } from '../client';
import { createCieStateApi } from './cie-state';

interface RecordedCall {
  readonly path: string;
  readonly action?: GreenAction | null;
  readonly body?: unknown;
  readonly schema: z.ZodType<unknown>;
  readonly opts?: RequestOptions;
}

function clientDouble(): { readonly client: ApiClient; readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: ApiClient = {
    get: <T>(path: string, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> => {
      calls.push({ path, schema, opts });
      return Promise.resolve({} as T);
    },
    postGreen: <T>(
      action: GreenAction | null,
      path: string,
      body: unknown,
      schema: z.ZodType<T>,
      opts?: RequestOptions,
    ): Promise<T> => {
      calls.push({ action, path, body, schema, opts });
      return Promise.resolve({} as T);
    },
    postYellow: <T>(
      _action: YellowAction,
      _path: string,
      _body: unknown,
      _schema: z.ZodType<T>,
    ): Promise<T> => Promise.reject(new Error('not used')),
    patch: <T>(_path: string, _body: unknown, _schema: z.ZodType<T>): Promise<T> =>
      Promise.reject(new Error('not used')),
    del: <T>(_path: string, _schema: z.ZodType<T>): Promise<T> =>
      Promise.reject(new Error('not used')),
  };
  return { client, calls };
}

describe('typed CIE state domain', () => {
  it('shape-verifies state and encoded dimension explanation responses', async () => {
    const { client, calls } = clientDouble();
    const api = createCieStateApi(client);

    await api.get();
    await api.explain('skills/unsafe');

    expect(calls).toEqual([
      { path: '/v1/cie/state', schema: cieStateResponseSchema, opts: undefined },
      {
        path: '/v1/cie/state/skills%2Funsafe/explain',
        schema: cieStateExplainResponseSchema,
        opts: undefined,
      },
    ]);
  });

  it('shape-verifies Green recompute and preserves its fact change context', async () => {
    const { client, calls } = clientDouble();

    await createCieStateApi(client).recompute({
      factId: 'skill:00000000-0000-4000-8000-000000000102',
      reason: 'User corrected demonstrated_skills',
    });

    expect(calls).toEqual([{
      action: 'memory.write',
      path: '/v1/cie/state/recompute',
      body: {
        factId: 'skill:00000000-0000-4000-8000-000000000102',
        reason: 'User corrected demonstrated_skills',
      },
      schema: cieStateResponseSchema,
      opts: undefined,
    }]);
  });
});