import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpportunityListResponse } from '@careeros/contracts';
import { EMPTY_OPPORTUNITIES, MATCH_BY_OPPORTUNITY, POPULATED_OPPORTUNITIES } from './opportunity-fixtures';
import { OpportunitiesClient, type OpportunityBrowseDependencies } from './OpportunitiesClient';

afterEach(cleanup);

function dependencies(list: OpportunityListResponse = POPULATED_OPPORTUNITIES): OpportunityBrowseDependencies {
  return {
    list: () => Promise.resolve(list),
    match: (id) => {
      const match = MATCH_BY_OPPORTUNITY[id];
      return match ? Promise.resolve(match) : Promise.reject(new Error(`No match fixture for ${id}`));
    },
  };
}

describe('FM3.1 opportunities browse', () => {
  it('renders every row with source and an explained match rather than a bare number', async () => {
    render(<OpportunitiesClient dependencies={dependencies()} />);
    const results = await screen.findByRole('list', { name: 'Opportunity results' });
    expect(within(results).getByText('Staff Backend Engineer')).toBeVisible();
    expect(within(results).getByText('greenhouse', { exact: false })).toBeVisible();
    expect(within(results).getByText('78% match')).toBeVisible();
    expect(within(results).getAllByRole('button', { name: 'Why this fit' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Load more opportunities' })).toBeEnabled();
  });

  it('sends a source filter through the typed list dependency and rerenders the response', async () => {
    const list = vi.fn<OpportunityBrowseDependencies['list']>((query) => {
      if (query.source === 'lever') {
        return Promise.resolve({ data: [POPULATED_OPPORTUNITIES.data[1]!], nextCursor: null });
      }
      return Promise.resolve(POPULATED_OPPORTUNITIES);
    });
    const user = userEvent.setup();
    render(<OpportunitiesClient dependencies={{ ...dependencies(), list }} />);
    await screen.findByText('Staff Backend Engineer');
    await user.selectOptions(screen.getByLabelText('Source'), 'lever');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ source: 'lever', limit: 10 }));
    expect(await screen.findByText('Senior Platform Engineer')).toBeVisible();
    expect(screen.queryByText('Staff Backend Engineer')).not.toBeInTheDocument();
  });

  it('renders an honest empty-list path without an invented role or score', async () => {
    render(<OpportunitiesClient dependencies={dependencies(EMPTY_OPPORTUNITIES)} />);
    expect(await screen.findByRole('heading', { name: 'No opportunities found' })).toBeVisible();
    expect(screen.getByText(/will not invent a role/i)).toBeVisible();
    expect(screen.queryByText(/% match/)).not.toBeInTheDocument();
  });

  it('uses the opaque cursor to append a second page', async () => {
    const first = { data: [POPULATED_OPPORTUNITIES.data[0]!], nextCursor: 'opaque-next' };
    const second = { data: [POPULATED_OPPORTUNITIES.data[1]!], nextCursor: null };
    const list = vi.fn<OpportunityBrowseDependencies['list']>((query) => Promise.resolve(query.cursor ? second : first));
    const user = userEvent.setup();
    render(<OpportunitiesClient dependencies={{ ...dependencies(), list }} />);
    await user.click(await screen.findByRole('button', { name: 'Load more opportunities' }));
    expect(await screen.findByText('Senior Platform Engineer')).toBeVisible();
    expect(list).toHaveBeenLastCalledWith({ cursor: 'opaque-next', limit: 10 });
  });
});
