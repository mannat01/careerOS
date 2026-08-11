import { describe, expect, it } from 'vitest';
import {
  profileImportResponseSchema,
  profileResponseSchema,
} from '@careeros/contracts';
import type { z } from 'zod';
import type { GreenAction, YellowAction } from '../approval';
import type { ApiClient, RequestOptions } from '../client';
import { createProfileApi } from './profile';

const NOW = '2026-08-10T12:00:00.000Z';
const PROFILE_RESPONSE = profileResponseSchema.parse({
  id: '00000000-0000-4000-8000-000000000100',
  headline: null,
  summary: null,
  targetRoles: [],
  locations: [],
  remotePreference: null,
  goals: [],
  experiences: [],
  projects: [],
  education: [],
  skills: [],
  createdAt: NOW,
  updatedAt: NOW,
});
const IMPORT_RESPONSE = profileImportResponseSchema.parse({
  profileId: '00000000-0000-4000-8000-000000000100',
  counts: { experiences: 0, projects: 0, education: 0, skillClaims: 0 },
  entities: [],
});

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
      return Promise.resolve(schema.parse(PROFILE_RESPONSE));
    },
    postGreen: <T>(
      action: GreenAction | null,
      path: string,
      body: unknown,
      schema: z.ZodType<T>,
      opts?: RequestOptions,
    ): Promise<T> => {
      calls.push({ action, path, body, schema, opts });
      return Promise.resolve(schema.parse(IMPORT_RESPONSE));
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

describe('typed profile domain', () => {
  it('shape-verifies GET /v1/profile with profileResponseSchema', async () => {
    const { client, calls } = clientDouble();

    await createProfileApi(client).get();

    expect(calls).toEqual([
      { path: '/v1/profile', schema: profileResponseSchema, opts: undefined },
    ]);
  });

  it('validates the text import request and shape-verifies its response', async () => {
    const { client, calls } = clientDouble();

    await createProfileApi(client).import({ resumeText: 'Exact résumé text' });

    expect(calls).toEqual([
      {
        action: 'memory.write',
        path: '/v1/profile/import',
        body: { resumeText: 'Exact résumé text' },
        schema: profileImportResponseSchema,
        opts: undefined,
      },
    ]);
  });

  it('rejects an empty import before transport', () => {
    const { client, calls } = clientDouble();

    expect(() => createProfileApi(client).import({ resumeText: '' })).toThrow();
    expect(calls).toHaveLength(0);
  });
});