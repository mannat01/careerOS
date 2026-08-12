import { describe, expect, it } from 'vitest';
import {
  approvalDenyResponseSchema,
  approvalEditResponseSchema,
  approvalExecuteResponseSchema,
  approvalMintResponseSchema,
  pendingApprovalListResponseSchema,
  approvalTokenSchema,
} from '@careeros/contracts';
import type { z } from 'zod';
import type { ApprovalToken, GreenAction, YellowAction } from '../approval';
import type { ApiClient, RequestOptions } from '../client';
import { createApprovalsApi } from './approvals';

function clientDouble(): { readonly client: ApiClient; readonly calls: unknown[] } {
  const calls: unknown[] = [];
  const client: ApiClient = {
    get: <T>(path: string, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> => {
      calls.push({ method: 'get', path, schema, opts }); return Promise.resolve({} as T);
    },
    postGreen: <T>(action: GreenAction | null, path: string, body: unknown, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> => {
      calls.push({ method: 'postGreen', action, path, body, schema, opts }); return Promise.resolve({} as T);
    },
    postYellow: <T>(action: YellowAction, path: string, body: unknown, schema: z.ZodType<T>, token: ApprovalToken, opts?: RequestOptions): Promise<T> => {
      calls.push({ method: 'postYellow', action, path, body, schema, token, opts }); return Promise.resolve({} as T);
    },
    patch: <T>(): Promise<T> => Promise.reject(new Error('not used')),
    del: <T>(): Promise<T> => Promise.reject(new Error('not used')),
  };
  return { client, calls };
}

describe('approvals lifecycle API uses FM5.1-pre contracts', () => {
  it('shape-verifies list and all four mutations with exact request bodies', async () => {
    const { client, calls } = clientDouble();
    const api = createApprovalsApi(client);
    const payload = { body: 'Exact payload' };

    await api.listPending();
    await api.mint('approval/id', { approvalId: 'approval/id', payload });
    await api.edit('approval/id', { approvalId: 'approval/id', payload });
    await api.execute('approval/id', { token: approvalTokenSchema.parse('single-use-token'), payload });
    await api.deny('approval/id', { approvalId: 'approval/id', reason: 'Not now.' });

    expect(calls).toEqual([
      { method: 'get', path: '/v1/approvals/pending', schema: pendingApprovalListResponseSchema, opts: undefined },
      { method: 'postGreen', action: null, path: '/v1/approvals/approval%2Fid/mint', body: { approvalId: 'approval/id', payload }, schema: approvalMintResponseSchema, opts: undefined },
      { method: 'postGreen', action: null, path: '/v1/approvals/approval%2Fid/edit', body: { approvalId: 'approval/id', payload }, schema: approvalEditResponseSchema, opts: undefined },
      { method: 'postYellow', action: 'briefing.item.execute', path: '/v1/approvals/approval%2Fid/execute', body: { token: 'single-use-token', payload }, schema: approvalExecuteResponseSchema, token: 'single-use-token', opts: undefined },
      { method: 'postGreen', action: null, path: '/v1/approvals/approval%2Fid/deny', body: { approvalId: 'approval/id', reason: 'Not now.' }, schema: approvalDenyResponseSchema, opts: undefined },
    ]);
  });

  it('rejects malformed request bodies before transport', () => {
    const { client, calls } = clientDouble();
    const api = createApprovalsApi(client);
    expect(() => api.mint('a', { approvalId: 'a', payload: [] } as never)).toThrow();
    expect(() => api.execute('a', { token: approvalTokenSchema.parse('valid-token'), payload: [], } as never)).toThrow();
    expect(() => api.deny('a', { approvalId: 'a', reason: '   ' })).toThrow();
    expect(calls).toHaveLength(0);
  });
});
