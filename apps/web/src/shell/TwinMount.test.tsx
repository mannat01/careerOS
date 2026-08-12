import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TwinStreamEvent } from '@careeros/contracts';

const streamEvents: TwinStreamEvent[] = [];
const close = vi.fn();
let streamFailure: Error | null = null;

vi.mock('../api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api')>();
  return {
    ...original,
    openTwinStream: vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        await Promise.resolve();
        for (const event of streamEvents) yield event;
        if (streamFailure) throw streamFailure;
      },
      close,
    })),
  };
});

import { TwinMount } from './TwinMount';

afterEach(() => { cleanup(); streamEvents.length = 0; streamFailure = null; close.mockClear(); });

describe('FM5.1 ambient Twin surface', () => {
  it('renders every canonical event with actual emitted fields', async () => {
    streamEvents.push(
      { type: 'context', summary: 'Loaded exact context.', evidenceIds: ['fact-1'], usedTokens: 5, budgetTokens: 20, truncated: false },
      { type: 'tool_call', tool: 'strategic_reasoner', input: { opportunityId: 'opp-1' } },
      { type: 'tool_result', tool: 'strategic_reasoner', ok: true, result: { decision: 'apply' } },
      { type: 'token', text: 'Exact canned token.' },
      { type: 'done', outcome: 'grounded_answer', finalText: 'Exact canned token.', modelVersion: 'fake-v1' },
    );
    const user = userEvent.setup();
    render(<TwinMount />);
    await user.click(screen.getByRole('button', { name: 'Open Twin (Command K)' }));
    await user.type(screen.getByLabelText('Question'), 'Should I apply?');
    await user.click(screen.getByRole('button', { name: 'Ask Twin' }));

    const sequence = await screen.findByRole('list', { name: 'Twin event sequence' });
    expect(within(sequence).getByText('Loaded exact context.')).toBeVisible();
    expect(sequence).toHaveTextContent('fact-1');
    expect(sequence).toHaveTextContent('strategic_reasoner');
    expect(sequence).toHaveTextContent('opp-1');
    expect(sequence).toHaveTextContent('apply');
    expect(sequence).toHaveTextContent('Exact canned token.');
    expect(sequence).toHaveTextContent('fake-v1');
    expect(screen.getByTestId('twin-status')).toHaveTextContent('complete');
  });

  it('visibly halts on approval_required and renders no queued post-halt content', async () => {
    streamEvents.push({
      type: 'approval_required', action: 'draft.send', tier: 'yellow',
      reason: 'External communication requires review.',
      payload: { body: 'Exact pending draft.' }, payloadHash: 'server-hash',
    });
    const user = userEvent.setup();
    render(<TwinMount />);
    await user.click(screen.getByRole('button', { name: 'Open Twin (Command K)' }));
    await user.type(screen.getByLabelText('Question'), 'Send it');
    await user.click(screen.getByRole('button', { name: 'Ask Twin' }));

    const halt = await screen.findByTestId('twin-approval-required');
    expect(halt).toHaveTextContent('Twin stopped before execution');
    expect(halt).toHaveTextContent('draft.send');
    expect(halt).toHaveTextContent('External communication requires review.');
    expect(halt).toHaveTextContent('Exact pending draft.');
    expect(halt).toHaveTextContent('Nothing auto-proceeded');
    expect(screen.getByTestId('twin-status')).toHaveTextContent('approval required');
    expect(screen.queryByText('THIS SHOULD NEVER APPEAR')).not.toBeInTheDocument();
  });

  it('renders an emitted error event and its typed visible recovery', async () => {
    const { ApiError } = await import('../api');
    streamEvents.push({ type: 'error', code: 'model_timeout', message: 'The fake model timed out.', traceId: 'trace-twin' });
    streamFailure = new ApiError({ code: 'internal', message: 'The fake model timed out.', details: { serverCode: 'model_timeout' }, traceId: 'trace-twin' });
    const user = userEvent.setup();
    render(<TwinMount />);
    await user.click(screen.getByRole('button', { name: 'Open Twin (Command K)' }));
    await user.type(screen.getByLabelText('Question'), 'Trigger failure');
    await user.click(screen.getByRole('button', { name: 'Ask Twin' }));

    const sequence = await screen.findByRole('list', { name: 'Twin event sequence' });
    expect(sequence).toHaveTextContent('model_timeout');
    expect(sequence).toHaveTextContent('The fake model timed out.');
    expect(await screen.findByTestId('error-recovery')).toHaveTextContent('The fake model timed out.');
    expect(screen.getByTestId('twin-status')).toHaveTextContent('error');
  });
});
