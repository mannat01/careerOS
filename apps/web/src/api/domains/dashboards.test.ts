import { describe, expect, it } from 'vitest';
import {
  dashboardDetailResponseSchema,
  dashboardListResponseSchema,
} from '@careeros/contracts';
import type { z } from 'zod';
import type { GreenAction, YellowAction } from '../approval';
import type { ApiClient, RequestOptions } from '../client';
import { createDashboardsApi } from './dashboards';

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
      postGreen: <T>(_action: GreenAction | null): Promise<T> => Promise.reject(new Error('Dashboards must not POST.')),
      postYellow: <T>(_action: YellowAction): Promise<T> => Promise.reject(new Error('Dashboards must not execute Yellow actions.')),
      patch: <T>(): Promise<T> => Promise.reject(new Error('Dashboards must not mutate.')),
      del: <T>(): Promise<T> => Promise.reject(new Error('Dashboards must not delete.')),
    },
  };
}

describe('typed read-only dashboards domain', () => {
  it('shape-verifies the list endpoint with the shared response schema', async () => {
    const { client, calls } = clientDouble();
    await createDashboardsApi(client).list();
    expect(calls).toEqual([{
      path: '/v1/cie/dashboards',
      schema: dashboardListResponseSchema,
      opts: undefined,
    }]);
  });

  it('shape-verifies a real metric detail path with the shared response schema', async () => {
    const { client, calls } = clientDouble();
    await createDashboardsApi(client).detail('career_momentum');
    expect(calls).toEqual([{
      path: '/v1/cie/dashboards/career_momentum',
      schema: dashboardDetailResponseSchema,
      opts: undefined,
    }]);
  });

  it('rejects metric-key drift before transport and exposes no action execution method', () => {
    const { client, calls } = clientDouble();
    const dashboards = createDashboardsApi(client);
    expect(() => dashboards.detail('invented_metric' as 'career_momentum')).toThrow();
    expect(calls).toHaveLength(0);
    expect(Object.keys(dashboards)).toEqual(['list', 'detail']);
    expect(dashboards).not.toHaveProperty('generate');
    expect(dashboards).not.toHaveProperty('approve');
    expect(dashboards).not.toHaveProperty('execute');
  });
});