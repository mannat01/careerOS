import { describe, expect, it } from 'vitest';
import { skillGapsResponseSchema } from '@careeros/contracts';
import type { z } from 'zod';
import type { GreenAction, YellowAction } from '../approval';
import type { ApiClient, RequestOptions } from '../client';
import { createSkillsApi } from './skills';

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
      postGreen: <T>(_action: GreenAction | null): Promise<T> => Promise.reject(new Error('Skills must not POST.')),
      postYellow: <T>(_action: YellowAction): Promise<T> => Promise.reject(new Error('Skills must not execute Yellow actions.')),
      patch: <T>(): Promise<T> => Promise.reject(new Error('Skills must not mutate.')),
      del: <T>(): Promise<T> => Promise.reject(new Error('Skills must not delete.')),
    },
  };
}

const OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000081';

describe('typed read-only skills domain', () => {
  it('shape-verifies the default full analysis with the shared response schema', async () => {
    const { client, calls } = clientDouble();
    await createSkillsApi(client).get();
    expect(calls).toEqual([{
      path: '/v1/skills/gaps',
      schema: skillGapsResponseSchema,
      opts: { query: {} },
    }]);
  });

  it('shape-verifies optional opportunityId and sends only that shared-contract query', async () => {
    const { client, calls } = clientDouble();
    await createSkillsApi(client).get({ opportunityId: OPPORTUNITY_ID });
    expect(calls[0]).toMatchObject({
      path: '/v1/skills/gaps',
      schema: skillGapsResponseSchema,
      opts: { query: { opportunityId: OPPORTUNITY_ID } },
    });
  });

  it('rejects query drift before transport and exposes no action-execution method', () => {
    const skills = createSkillsApi(clientDouble().client);
    expect(() => skills.get({ opportunityId: 'not-a-uuid' })).toThrow();
    expect(Object.keys(skills)).toEqual(['get']);
    expect(skills).not.toHaveProperty('generate');
    expect(skills).not.toHaveProperty('update');
    expect(skills).not.toHaveProperty('approve');
    expect(skills).not.toHaveProperty('execute');
  });
});