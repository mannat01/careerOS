import { describe, expect, it } from 'vitest';
import { draftResponseSchema } from '@careeros/contracts';
import type { z } from 'zod';
import type { GreenAction, YellowAction } from '../approval';
import type { ApiClient, RequestOptions } from '../client';
import { createDraftsApi } from './drafts';

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
      postYellow: <T>(_action: YellowAction): Promise<T> => Promise.reject(new Error('Draft generation must never be Yellow.')),
      patch: <T>(): Promise<T> => Promise.reject(new Error('not used')),
      del: <T>(): Promise<T> => Promise.reject(new Error('not used')),
    },
  };
}

const OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000063';

describe('typed Green drafts domain', () => {
  it('shape-verifies the request and discriminated response through shared contracts', async () => {
    const { client, calls } = clientDouble();
    const body = {
      kind: 'outreach' as const,
      opportunityId: OPPORTUNITY_ID,
      recipient: { name: 'Dana', role: 'Hiring manager', channel: 'email' },
    };
    await createDraftsApi(client).generate(body);
    expect(calls).toEqual([{
      action: null,
      path: '/v1/drafts',
      body,
      schema: draftResponseSchema,
      opts: undefined,
    }]);
  });

  it('rejects a non-contract request before transport and exposes no send method', () => {
    const { client } = clientDouble();
    const drafts = createDraftsApi(client);
    expect(() => drafts.generate({ kind: 'cover_letter', opportunityId: 'not-a-uuid' })).toThrow();
    expect(drafts).not.toHaveProperty('send');
    expect(drafts).not.toHaveProperty('submit');
  });
});