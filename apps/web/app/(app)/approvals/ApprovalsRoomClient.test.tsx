import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  approvalDenyResponseSchema,
  approvalEditResponseSchema,
  approvalExecuteResponseSchema,
  approvalMintResponseSchema,
  pendingApprovalListResponseSchema,
} from '@careeros/contracts';
import { ApiError } from '@/api';
import { _resetPendingApprovalsForTests } from '@/shell';
import { ApprovalsRoomClient, type ApprovalsRoomDependencies } from './ApprovalsRoomClient';

const NOW = '2026-08-12T12:00:00.000Z';
const HASH = 'a'.repeat(64);
const APPROVAL = pendingApprovalListResponseSchema.parse({
  data: [{
    id: 'approval-1',
    action: 'briefing.item.execute',
    why: 'Send this exact prepared outreach only after review.',
    payload: { to: 'recruiter@example.com', body: 'Original exact draft.' },
    tier: 'yellow',
    resourceRefs: [{ type: 'briefingRun', id: 'briefing-1' }],
    state: 'proposed',
    createdAt: NOW,
  }],
}).data[0]!;

afterEach(() => { cleanup(); _resetPendingApprovalsForTests(); });

function dependencies(overrides: Partial<ApprovalsRoomDependencies> = {}): ApprovalsRoomDependencies {
  return {
    list: () => Promise.resolve({ data: [APPROVAL] }),
    mint: () => Promise.resolve(approvalMintResponseSchema.parse({ token: 'token-1', expiresAt: '2026-08-12T12:05:00.000Z', action: APPROVAL.action, payloadHash: HASH })),
    edit: (id, payload) => Promise.resolve(approvalEditResponseSchema.parse({ approvalId: id, state: 'proposed', payload })),
    execute: (id) => Promise.resolve(approvalExecuteResponseSchema.parse({ approvalId: id, action: APPROVAL.action, state: 'executed', outcome: 'briefing_item_executed', executedAt: NOW })),
    deny: (id) => Promise.resolve(approvalDenyResponseSchema.parse({ approvalId: id, state: 'denied', deniedAt: NOW })),
    ...overrides,
  };
}

async function openReview(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await screen.findByTestId('approval-card-approval-1');
  await user.click(screen.getByRole('button', { name: 'Review approval' }));
  return screen.getByRole('dialog', { name: `Review ${APPROVAL.action}` });
}

describe('FM5.1 Approvals room', () => {
  it('renders persisted action, why, exact payload, tier, refs, and state', async () => {
    render(<ApprovalsRoomClient dependencies={dependencies()} />);
    const card = await screen.findByTestId('approval-card-approval-1');
    expect(card).toHaveTextContent(APPROVAL.action);
    expect(card).toHaveTextContent(APPROVAL.why);
    expect(card).toHaveTextContent('yellow · proposed');
    expect(card).toHaveTextContent('briefingRun: briefing-1');
    expect(screen.getByTestId('approval-payload-approval-1')).toHaveTextContent('Original exact draft.');
  });

  it('mint → execute uses the exact shown payload and one returned token, then renders outcome', async () => {
    const mint = vi.fn(dependencies().mint);
    const execute = vi.fn(dependencies().execute);
    const user = userEvent.setup();
    render(<ApprovalsRoomClient dependencies={dependencies({ mint, execute })} />);
    const dialog = await openReview(user);

    expect(within(dialog).getByRole('button', { name: 'Execute approved action' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Approve exact payload' }));
    expect(await within(dialog).findByText('Approved for this exact payload')).toBeVisible();
    expect(screen.getByTestId('approval-card-approval-1')).toHaveTextContent('yellow · approved');
    await user.click(within(dialog).getByRole('button', { name: 'Execute approved action' }));

    expect(mint).toHaveBeenCalledWith(APPROVAL.id, APPROVAL.payload);
    expect(execute).toHaveBeenCalledWith(APPROVAL.id, 'token-1', APPROVAL.payload);
    expect(execute).toHaveBeenCalledOnce();
    expect(await screen.findByTestId('approval-outcome')).toHaveTextContent('briefing_item_executed');
    expect(screen.queryByTestId('approval-card-approval-1')).not.toBeInTheDocument();
  });

  it('edit invalidates the grant, persists proposed, and forces a fresh mint before execute', async () => {
    const mint = vi.fn(dependencies().mint);
    const edit = vi.fn(dependencies().edit);
    const execute = vi.fn(dependencies().execute);
    const user = userEvent.setup();
    render(<ApprovalsRoomClient dependencies={dependencies({ mint, edit, execute })} />);
    const dialog = await openReview(user);

    await user.click(within(dialog).getByRole('button', { name: 'Approve exact payload' }));
    expect(within(dialog).getByRole('button', { name: 'Execute approved action' })).toBeEnabled();
    const editor = within(dialog).getByLabelText('Exact payload (JSON)');
    fireEvent.change(editor, { target: { value: JSON.stringify({ to: 'recruiter@example.com', body: 'Edited exact draft.' }) } });

    expect(within(dialog).getByText(/Any prior token is unusable/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Execute approved action' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Approve exact payload' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Save payload changes' }));
    expect(edit).toHaveBeenCalledWith(APPROVAL.id, { to: 'recruiter@example.com', body: 'Edited exact draft.' });
    expect(execute).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Execute approved action' })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: 'Approve exact payload' }));
    expect(mint).toHaveBeenCalledTimes(2);
    expect(mint).toHaveBeenLastCalledWith(APPROVAL.id, { to: 'recruiter@example.com', body: 'Edited exact draft.' });
    expect(within(dialog).getByRole('button', { name: 'Execute approved action' })).toBeEnabled();
  });

  it.each(['token_consumed', 'token_expired', 'payload_mismatch'] as const)('renders %s as a failed action and requires re-approval', async (reason) => {
    const execute = vi.fn(() => Promise.reject(new ApiError({
      code: 'capability_denied', status: 403, message: 'Approval token was refused.', details: { reason },
    })));
    const user = userEvent.setup();
    render(<ApprovalsRoomClient dependencies={dependencies({ execute })} />);
    const dialog = await openReview(user);
    await user.click(within(dialog).getByRole('button', { name: 'Approve exact payload' }));
    await user.click(within(dialog).getByRole('button', { name: 'Execute approved action' }));

    const recovery = await within(dialog).findByTestId('approval-token-recovery');
    expect(recovery).toHaveTextContent(reason);
    expect(recovery).toHaveTextContent('The action did not succeed');
    expect(within(dialog).getByRole('button', { name: 'Execute approved action' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Approve exact payload' })).toBeEnabled();
  });

  it('renders a 409 post-deny state as terminal server truth, never success', async () => {
    const mint = vi.fn(() => Promise.reject(new ApiError({
      code: 'conflict', status: 409, message: 'Approval is terminal: denied.', details: { state: 'denied' },
    })));
    const user = userEvent.setup();
    render(<ApprovalsRoomClient dependencies={dependencies({ mint })} />);
    const dialog = await openReview(user);
    await user.click(within(dialog).getByRole('button', { name: 'Approve exact payload' }));

    const recovery = await within(dialog).findByTestId('approval-terminal-recovery');
    expect(recovery).toHaveTextContent('already terminal');
    expect(recovery).toHaveTextContent('Approval is terminal: denied.');
    expect(within(dialog).getByRole('button', { name: 'Execute approved action' })).toBeDisabled();
    expect(screen.queryByText('Action executed')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close and reload' }));
    expect(await screen.findByTestId('approval-card-approval-1')).toBeVisible();
  });

  it('denies with the real reason and removes the terminal item only after server success', async () => {
    const deny = vi.fn(dependencies().deny);
    const user = userEvent.setup();
    render(<ApprovalsRoomClient dependencies={dependencies({ deny })} />);
    const dialog = await openReview(user);
    await user.type(within(dialog).getByLabelText('Reason'), 'Not ready to send.');
    await user.click(within(dialog).getByRole('button', { name: 'Deny approval' }));
    expect(deny).toHaveBeenCalledWith(APPROVAL.id, 'Not ready to send.');
    expect(await screen.findByTestId('approval-outcome')).toHaveTextContent('No action was executed');
    expect(screen.queryByTestId('approval-card-approval-1')).not.toBeInTheDocument();
  });

  it('renders the honest server empty state', async () => {
    render(<ApprovalsRoomClient dependencies={dependencies({ list: () => Promise.resolve({ data: [] }) })} />);
    expect(await screen.findByText('No pending approvals. Nothing is waiting for your decision.')).toBeVisible();
  });
});
