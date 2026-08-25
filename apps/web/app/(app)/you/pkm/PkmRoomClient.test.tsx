import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PkmCreateRequest, PkmDeleteResponse, PkmEntry, PkmUpdateRequest } from '@careeros/contracts';
import { ApiError } from '@/api';
import { PkmRoomClient, type PkmRoomDependencies } from './PkmRoomClient';
import {
  CREATED_PKM_ENTRY,
  DELETED_PKM_ENTRY,
  EMPTY_PKM,
  PKM_ENTRY,
  POPULATED_PKM,
  UPDATED_PKM_ENTRY,
} from './pkm-fixtures';

afterEach(cleanup);

function dependencies(overrides: Partial<PkmRoomDependencies> = {}): PkmRoomDependencies {
  return {
    list: () => Promise.resolve(POPULATED_PKM),
    create: () => Promise.resolve(CREATED_PKM_ENTRY),
    update: () => Promise.resolve(UPDATED_PKM_ENTRY),
    delete: () => Promise.resolve(DELETED_PKM_ENTRY),
    ...overrides,
  };
}

describe('FM6.8 PKM room', () => {
  it('renders contract entries with title, body, tags, user provenance, and backend timestamps only', async () => {
    render(<PkmRoomClient dependencies={dependencies()} />);
    const entry = await screen.findByTestId(`pkm-entry-${PKM_ENTRY.id}`);
    expect(entry).toHaveTextContent('Platform notes');
    expect(entry).toHaveTextContent('Prefer reversible migrations.');
    expect(entry).toHaveTextContent('Measure operational impact.');
    expect(entry).toHaveTextContent('platform');
    expect(entry).toHaveTextContent('architecture');
    expect(within(entry).getByTestId('provenance-tag')).toHaveAttribute('data-provenance', 'user');
    expect(within(entry).getByTestId('provenance-tag')).toHaveTextContent('You added');
    expect(entry).toHaveTextContent('Provenance: user');
    expect(entry).toHaveTextContent('Aug 24, 2026, 12:00 PM UTC');
    expect(entry).toHaveTextContent('Aug 24, 2026, 1:30 PM UTC');
    expect(screen.queryByTestId('ai-surface')).not.toBeInTheDocument();
    expect(screen.queryByTestId('confidence-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('approval-dialog')).not.toBeInTheDocument();
  });

  it('renders the honest empty state with a working create path', async () => {
    render(<PkmRoomClient dependencies={dependencies({ list: () => Promise.resolve(EMPTY_PKM) })} />);
    expect(await screen.findByText('No entries yet')).toBeVisible();
    expect(screen.getByText('Use the create form above to add your first entry.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create entry' })).toBeVisible();
  });

  it('creates optimistically without fabricating server identity, provenance, or timestamps', async () => {
    let resolveCreate: ((entry: PkmEntry) => void) | undefined;
    const create = vi.fn((_body: PkmCreateRequest) => new Promise<PkmEntry>((resolve) => { resolveCreate = resolve; }));
    const user = userEvent.setup();
    render(<PkmRoomClient dependencies={dependencies({ list: () => Promise.resolve(EMPTY_PKM), create })} />);
    await screen.findByText('No entries yet');

    const form = screen.getByTestId('pkm-create-form');
    await user.type(within(form).getByLabelText('Title'), 'Interview reflection');
    await user.type(within(form).getByLabelText('Body'), 'Ask for concrete examples.');
    await user.type(within(form).getByLabelText(/Tags/), 'interview');
    await user.click(within(form).getByRole('button', { name: 'Create entry' }));

    expect(create).toHaveBeenCalledWith({ title: 'Interview reflection', body: 'Ask for concrete examples.', tags: ['interview'] });
    const pending = await screen.findByTestId('pkm-pending-entry');
    expect(pending).toHaveTextContent('Saving entry…');
    expect(pending).toHaveTextContent('Provenance and timestamps will appear only after the server saves this entry.');
    expect(within(pending).queryByTestId('provenance-tag')).not.toBeInTheDocument();
    resolveCreate?.(CREATED_PKM_ENTRY);
    const saved = await screen.findByTestId(`pkm-entry-${CREATED_PKM_ENTRY.id}`);
    expect(saved).toHaveTextContent('Interview reflection');
    expect(within(saved).getByTestId('provenance-tag')).toHaveAttribute('data-provenance', 'user');
  });

  it('sends a partial edit, shows it optimistically, then merges server timestamps', async () => {
    let resolveUpdate: ((entry: PkmEntry) => void) | undefined;
    const update = vi.fn((_id: string, _body: PkmUpdateRequest) => new Promise<PkmEntry>((resolve) => { resolveUpdate = resolve; }));
    const user = userEvent.setup();
    render(<PkmRoomClient dependencies={dependencies({ update })} />);
    const card = await screen.findByTestId(`pkm-entry-${PKM_ENTRY.id}`);
    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    const form = screen.getByTestId('pkm-edit-form');
    const title = within(form).getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Updated platform notes');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));

    expect(update).toHaveBeenCalledWith(PKM_ENTRY.id, { title: 'Updated platform notes' });
    const optimistic = await screen.findByTestId(`pkm-entry-${PKM_ENTRY.id}`);
    expect(optimistic).toHaveTextContent('Updated platform notes');
    expect(optimistic).toHaveTextContent('Saving changes…');
    expect(optimistic).toHaveTextContent('Aug 24, 2026, 1:30 PM UTC');
    resolveUpdate?.(UPDATED_PKM_ENTRY);
    await waitFor(() => expect(screen.getByTestId(`pkm-entry-${PKM_ENTRY.id}`)).toHaveTextContent('Aug 24, 2026, 2:00 PM UTC'));
    expect(screen.queryByText('Saving changes…')).not.toBeInTheDocument();
  });

  it('never deletes without the explicit non-ApprovalDialog confirmation', async () => {
    let resolveDelete: ((response: PkmDeleteResponse) => void) | undefined;
    const del = vi.fn((_id: string) => new Promise<PkmDeleteResponse>((resolve) => { resolveDelete = resolve; }));
    const user = userEvent.setup();
    render(<PkmRoomClient dependencies={dependencies({ delete: del })} />);
    const card = await screen.findByTestId(`pkm-entry-${PKM_ENTRY.id}`);

    await user.click(within(card).getByRole('button', { name: 'Delete' }));
    let dialog = screen.getByRole('dialog', { name: "Delete this entry? This can't be undone." });
    expect(del).not.toHaveBeenCalled();
    expect(screen.queryByTestId('approval-dialog')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Keep entry' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Keep entry' }));
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByTestId(`pkm-entry-${PKM_ENTRY.id}`)).toBeVisible();

    await user.click(within(screen.getByTestId(`pkm-entry-${PKM_ENTRY.id}`)).getByRole('button', { name: 'Delete' }));
    dialog = screen.getByRole('dialog', { name: "Delete this entry? This can't be undone." });
    await user.click(within(dialog).getByRole('button', { name: 'Delete entry permanently' }));
    expect(del).toHaveBeenCalledOnce();
    expect(del).toHaveBeenCalledWith(PKM_ENTRY.id);
    expect(screen.queryByTestId(`pkm-entry-${PKM_ENTRY.id}`)).not.toBeInTheDocument();
    resolveDelete?.(DELETED_PKM_ENTRY);
    await waitFor(() => expect(screen.getByText('No entries yet')).toBeVisible());
  });

  it('rolls back a failed create and shows the real 422 recovery with form content preserved', async () => {
    const create = vi.fn(() => Promise.reject(new ApiError({
      code: 'validation_failed', status: 422, message: 'Invalid PKM entry.', details: { title: 'Title is invalid.' },
    })));
    const user = userEvent.setup();
    render(<PkmRoomClient dependencies={dependencies({ list: () => Promise.resolve(EMPTY_PKM), create })} />);
    await screen.findByText('No entries yet');
    const form = screen.getByTestId('pkm-create-form');
    await user.type(within(form).getByLabelText('Title'), 'Rejected entry');
    await user.type(within(form).getByLabelText('Body'), 'Keep this draft after rollback.');
    await user.click(within(form).getByRole('button', { name: 'Create entry' }));
    const recovery = await screen.findByTestId('error-recovery');
    expect(recovery).toHaveAttribute('data-code', 'validation_failed');
    expect(screen.queryByTestId('pkm-pending-entry')).not.toBeInTheDocument();
    expect(within(form).getByLabelText('Title')).toHaveValue('Rejected entry');
    expect(within(form).getByLabelText('Body')).toHaveValue('Keep this draft after rollback.');
  });

  it('rolls back a missing-entry edit and exposes typed 404 recovery', async () => {
    const update = vi.fn(() => Promise.reject(new ApiError({ code: 'not_found', status: 404, message: 'PKM entry not found.' })));
    const user = userEvent.setup();
    render(<PkmRoomClient dependencies={dependencies({ update })} />);
    await user.click(within(await screen.findByTestId(`pkm-entry-${PKM_ENTRY.id}`)).getByRole('button', { name: 'Edit' }));
    const form = screen.getByTestId('pkm-edit-form');
    const title = within(form).getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Missing entry update');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    const recovery = await screen.findByTestId('error-recovery');
    expect(recovery).toHaveAttribute('data-code', 'not_found');
    expect(screen.getByTestId('pkm-edit-form')).toBeVisible();
    expect(screen.queryByText('Saving changes…')).not.toBeInTheDocument();
  });

  it('rolls back a network-failed delete before rendering typed recovery', async () => {
    const del = vi.fn(() => Promise.reject(new Error('Network connection lost.')));
    const user = userEvent.setup();
    render(<PkmRoomClient dependencies={dependencies({ delete: del })} />);
    await user.click(within(await screen.findByTestId(`pkm-entry-${PKM_ENTRY.id}`)).getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete entry permanently' }));
    const recovery = await screen.findByTestId('error-recovery');
    expect(recovery).toHaveAttribute('data-code', 'internal');
    expect(recovery).toHaveTextContent('Network connection lost.');
    expect(screen.getByTestId(`pkm-entry-${PKM_ENTRY.id}`)).toBeVisible();
  });

  it('fails typed on list response drift and never renders unparsed data', async () => {
    const drifted = { data: [{ ...PKM_ENTRY, provenance: 'imported', secret: 'must not render' }] } as never;
    render(<PkmRoomClient dependencies={dependencies({ list: () => Promise.resolve(drifted) })} />);
    expect(await screen.findByTestId('error-recovery')).toHaveAttribute('data-code', 'internal');
    expect(screen.queryByText('must not render')).not.toBeInTheDocument();
  });
});