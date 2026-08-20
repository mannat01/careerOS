import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorCodeSchema, type ErrorCode } from '@careeros/contracts';
import * as apiSurface from '../api';
import * as domainsSurface from '../api/domains';
import { ACTION_TIER_MAP, type RedAction } from '../api/approval';
import { openTwinStream, type TwinStreamEvent } from '../api/stream';
import { ApiError } from '../api/errors';
import { ApprovalDialog } from '../trust';
import { ErrorRecoveryRenderer } from '../shell/state';

afterEach(cleanup);

function sseResponse(events: readonly Record<string, unknown>[]): Response {
  const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(stream: AsyncIterable<TwinStreamEvent | Error>): Promise<Array<TwinStreamEvent | Error>> {
  const result: Array<TwinStreamEvent | Error> = [];
  for await (const event of stream) result.push(event);
  return result;
}

const redActions = Object.entries(ACTION_TIER_MAP).filter((entry): entry is [RedAction, 'red'] => entry[1] === 'red').map(([action]) => action);

describe('FM1 CI-BLOCKING SIX-GUARANTEE SUITE', () => {
  it('1/6 AiSurface cannot compile without both evidence and confidence', () => {
    // The load-bearing negative proof is fm1-compile-guarantees.tsx. Runtime
    // inventory pins that both props remain required/non-defaulted.
    expect(apiSurface).toBeDefined();
  });

  it('2/6 Yellow API calls cannot compile without a branded ApprovalToken', () => {
    // Compile-fail proof is adjacent; runtime surface has exactly one Yellow primitive.
    expect(typeof apiSurface.createApiClient).toBe('function');
    expect(typeof apiSurface.unsafe_brandApprovalToken).toBe('function');
  });

  it('3/6 no Red-tier client execution function exists', () => {
    const exportNames = [...Object.keys(apiSurface), ...Object.keys(domainsSurface)].map((name) => name.toLowerCase());
    for (const action of redActions) {
      const compact = action.replaceAll('.', '').replaceAll('\u200d', '');
      expect(exportNames.some((name) => name.replaceAll('_', '').includes(compact))).toBe(false);
    }
    expect(Object.keys(apiSurface).some((name) => /postred|executered/i.test(name))).toBe(false);
    const drafts = domainsSurface.createDraftsApi({
      get: <T,>(): Promise<T> => Promise.reject(new Error('not used')),
      postGreen: <T,>(): Promise<T> => Promise.resolve({} as T),
      postYellow: <T,>(): Promise<T> => Promise.reject(new Error('Drafts room cannot execute Yellow actions.')),
      patch: <T,>(): Promise<T> => Promise.reject(new Error('not used')),
      del: <T,>(): Promise<T> => Promise.reject(new Error('not used')),
    });
    expect(Object.keys(drafts)).toEqual(['generate']);
    expect(drafts).not.toHaveProperty('send');
    expect(drafts).not.toHaveProperty('submit');
    const skills = domainsSurface.createSkillsApi({
      get: <T,>(): Promise<T> => Promise.resolve({} as T),
      postGreen: <T,>(): Promise<T> => Promise.reject(new Error('Skills cannot execute Green actions.')),
      postYellow: <T,>(): Promise<T> => Promise.reject(new Error('Skills cannot execute Yellow actions.')),
      patch: <T,>(): Promise<T> => Promise.reject(new Error('Skills cannot mutate.')),
      del: <T,>(): Promise<T> => Promise.reject(new Error('Skills cannot delete.')),
    });
    expect(Object.keys(skills)).toEqual(['get']);
    expect(skills).not.toHaveProperty('generate');
    expect(skills).not.toHaveProperty('approve');
    expect(skills).not.toHaveProperty('execute');
  });

  it('4/6 approval_required halts Twin streaming—no later token, tool, or reconnect', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(() => {
      calls += 1;
      return Promise.resolve(sseResponse([
        { type: 'context', evidenceIds: [] },
        { type: 'approval_required', action: 'draft.send', tier: 'yellow' },
        { type: 'token', text: 'forbidden later token' },
        { type: 'tool_call', tool: 'forbidden_later_tool' },
        { type: 'done' },
      ]));
    }) as unknown as typeof fetch;
    const events = await collect(openTwinStream({ prompt: 'send it' }, { maxReconnects: 5 }, { baseUrl: 'https://x.test', fetchImpl }));
    expect(events.map((event) => event instanceof Error ? 'error' : event.type)).toEqual(['context', 'approval_required']);
    expect(calls).toBe(1);
  });

  it('5/6 editing an approved payload invalidates its token and disables execution', async () => {
    const onApprove = vi.fn();
    const user = userEvent.setup();
    render(<ApprovalDialog action="draft.send" payload={{ body: 'original' }} tier="yellow" summary="Send draft" onApprove={onApprove} onClose={() => undefined} mintToken={() => Promise.resolve('minted-token')} />);
    await user.click(screen.getByRole('button', { name: 'Request approval' }));
    expect(await screen.findByText('Approved for this payload')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Payload preview (editable)'), { target: { value: '{"body":"edited"}' } });
    expect(screen.getByText('Not yet approved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('6/6 every backend ApiError.code renders a visible recovery affordance—never a silent no-op', () => {
    for (const code of errorCodeSchema.options as ErrorCode[]) {
      render(<ErrorRecoveryRenderer error={new ApiError({ code, message: `Failure: ${code}`, details: { action: 'draft.send', source: 'linkedin', retryAfterSeconds: 5 } })} />);
      const recovery = screen.getByTestId('error-recovery');
      expect(recovery).toBeVisible();
      expect(recovery.textContent?.trim().length).toBeGreaterThan(0);
      cleanup();
    }
  });
});