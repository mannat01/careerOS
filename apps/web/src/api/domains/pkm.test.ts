import { describe, expect, it } from 'vitest';
import {
  pkmCreateRequestSchema,
  pkmDeleteResponseSchema,
  pkmEntrySchema,
  pkmListResponseSchema,
  pkmUpdateRequestSchema,
} from '@careeros/contracts';
import type { z } from 'zod';
import type { GreenAction, YellowAction } from '../approval';
import type { ApiClient, RequestOptions } from '../client';
import { createPkmApi } from './pkm';

type Call = {
  readonly method: 'get' | 'postGreen' | 'patch' | 'delete';
  readonly action?: GreenAction | null;
  readonly path: string;
  readonly body?: unknown;
  readonly schema: z.ZodType<unknown>;
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
      postYellow: <T>(_action: YellowAction): Promise<T> => Promise.reject(new Error('PKM must never use a Yellow flow.')),
      patch: <T>(path: string, body: unknown, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> => {
        calls.push({ method: 'patch', path, body, schema, opts });
        return Promise.resolve({} as T);
      },
      del: <T>(path: string, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> => {
        calls.push({ method: 'delete', path, schema, opts });
        return Promise.resolve({} as T);
      },
    },
  };
}

describe('typed PKM domain', () => {
  it('shape-verifies every request and response with shared PKM contracts', async () => {
    const { client, calls } = clientDouble();
    const pkm = createPkmApi(client);
    const id = 'entry/with slash';
    await pkm.list();
    await pkm.create({ title: 'Note', body: 'Body', tags: ['career'] });
    await pkm.update(id, { title: 'Updated' });
    await pkm.delete(id);

    expect(calls).toEqual([
      { method: 'get', path: '/v1/pkm', schema: pkmListResponseSchema, opts: undefined },
      { method: 'postGreen', action: null, path: '/v1/pkm', body: { title: 'Note', body: 'Body', tags: ['career'] }, schema: pkmEntrySchema, opts: undefined },
      { method: 'patch', path: `/v1/pkm/${encodeURIComponent(id)}`, body: { title: 'Updated' }, schema: pkmEntrySchema, opts: undefined },
      { method: 'delete', path: `/v1/pkm/${encodeURIComponent(id)}`, schema: pkmDeleteResponseSchema, opts: undefined },
    ]);
  });

  it('rejects unknown identity/provenance fields and empty updates before transport', () => {
    const { client, calls } = clientDouble();
    const pkm = createPkmApi(client);
    expect(() => pkm.create({ title: 'Note', body: 'Body', userId: 'client-id' } as never)).toThrow();
    expect(() => pkm.create({ title: 'Note', body: 'Body', provenance: 'user' } as never)).toThrow();
    expect(() => pkm.update('entry', {})).toThrow();
    expect(calls).toEqual([]);
    expect(pkmCreateRequestSchema.safeParse({ title: 'Note', body: 'Body' }).success).toBe(true);
    expect(pkmUpdateRequestSchema.safeParse({ body: 'Changed' }).success).toBe(true);
  });
});