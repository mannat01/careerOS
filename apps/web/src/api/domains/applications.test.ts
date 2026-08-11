import { describe, expect, it } from 'vitest';
import {
  applicationDetailSchema,
  applicationListResponseSchema,
} from '@careeros/contracts';
import type { z } from 'zod';
import type { GreenAction, YellowAction } from '../approval';
import type { ApiClient, RequestOptions } from '../client';
import { createApplicationsApi } from './applications';

interface RecordedCall {
  readonly method: 'get' | 'postGreen' | 'patch';
  readonly path: string;
  readonly body?: unknown;
  readonly schema: z.ZodType<unknown>;
  readonly opts?: RequestOptions;
}

function clientDouble(): { readonly client: ApiClient; readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: ApiClient = {
    get: <T>(path: string, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> => {
      calls.push({ method: 'get', path, schema, opts });
      return Promise.resolve({} as T);
    },
    postGreen: <T>(_action: GreenAction | null, path: string, body: unknown, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> => {
      calls.push({ method: 'postGreen', path, body, schema, opts });
      return Promise.resolve({} as T);
    },
    postYellow: <T>(_action: YellowAction): Promise<T> => Promise.reject(new Error('pipeline board must never postYellow')),
    patch: <T>(path: string, body: unknown, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> => {
      calls.push({ method: 'patch', path, body, schema, opts });
      return Promise.resolve({} as T);
    },
    del: <T>(): Promise<T> => Promise.reject(new Error('not used')),
  };
  return { client, calls };
}

const OPP_ID = '00000000-0000-4000-8000-0000000000aa';
const APP_ID = 'app-with/slash';

describe('typed applications domain', () => {
  it('shape-verifies the list envelope', async () => {
    const { client, calls } = clientDouble();
    await createApplicationsApi(client).list();
    expect(calls).toEqual([{ method: 'get', path: '/v1/applications', schema: applicationListResponseSchema, opts: undefined }]);
  });

  it('shape-verifies create and validates the request body at the boundary', async () => {
    const { client, calls } = clientDouble();
    await createApplicationsApi(client).create({ opportunityId: OPP_ID });
    expect(calls).toEqual([{
      method: 'postGreen',
      path: '/v1/applications',
      body: { opportunityId: OPP_ID },
      schema: applicationDetailSchema,
      opts: undefined,
    }]);
  });

  it('rejects a create body with a non-uuid opportunity id at the boundary', () => {
    const { client } = clientDouble();
    expect(() => createApplicationsApi(client).create({ opportunityId: 'not-a-uuid' })).toThrow();
  });

  it('shape-verifies patch, url-encodes the id, and forwards iSubmitted for the applied gate', async () => {
    const { client, calls } = clientDouble();
    await createApplicationsApi(client).patch(APP_ID, { status: 'drafting' });
    await createApplicationsApi(client).patch(APP_ID, { status: 'applied', iSubmitted: true });
    expect(calls).toEqual([
      {
        method: 'patch',
        path: `/v1/applications/${encodeURIComponent(APP_ID)}`,
        body: { status: 'drafting' },
        schema: applicationDetailSchema,
        opts: undefined,
      },
      {
        method: 'patch',
        path: `/v1/applications/${encodeURIComponent(APP_ID)}`,
        body: { status: 'applied', iSubmitted: true },
        schema: applicationDetailSchema,
        opts: undefined,
      },
    ]);
  });

  it('rejects a patch that changes nothing (contract requires at least one field)', () => {
    const { client } = clientDouble();
    expect(() => createApplicationsApi(client).patch(APP_ID, {})).toThrow();
  });
});
