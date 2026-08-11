import { describe, expect, it } from 'vitest';
import {
  opportunityDetailSchema,
  opportunityListResponseSchema,
  opportunityMatchResponseSchema,
} from '@careeros/contracts';
import type { z } from 'zod';
import type { GreenAction, YellowAction } from '../approval';
import type { ApiClient, RequestOptions } from '../client';
import { createOpportunitiesApi } from './opportunities';

interface RecordedCall {
  readonly path: string;
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
    postGreen: <T>(_action: GreenAction | null, _path: string, _body: unknown, _schema: z.ZodType<T>): Promise<T> => Promise.reject(new Error('not used')),
    postYellow: <T>(_action: YellowAction, _path: string, _body: unknown, _schema: z.ZodType<T>): Promise<T> => Promise.reject(new Error('not used')),
    patch: <T>(_path: string, _body: unknown, _schema: z.ZodType<T>): Promise<T> => Promise.reject(new Error('not used')),
    del: <T>(_path: string, _schema: z.ZodType<T>): Promise<T> => Promise.reject(new Error('not used')),
  };
  return { client, calls };
}

describe('typed opportunities domain', () => {
  it('shape-verifies list and transports the four supported filters plus cursor', async () => {
    const { client, calls } = clientDouble();
    await createOpportunitiesApi(client).list({
      source: 'lever', remote: false, comp: true, freshness: 7, cursor: 'opaque', limit: 10,
    });
    expect(calls).toEqual([{
      path: '/v1/opportunities',
      schema: opportunityListResponseSchema,
      opts: { query: { cursor: 'opaque', limit: 10, source: 'lever', remote: false, comp: true, freshness: 7 } },
    }]);
  });

  it('shape-verifies encoded detail and match responses', async () => {
    const { client, calls } = clientDouble();
    const api = createOpportunitiesApi(client);
    await api.get('role/unsafe');
    await api.match('role/unsafe');
    expect(calls).toEqual([
      { path: '/v1/opportunities/role%2Funsafe', schema: opportunityDetailSchema, opts: undefined },
      { path: '/v1/opportunities/role%2Funsafe/match', schema: opportunityMatchResponseSchema, opts: undefined },
    ]);
  });
});
