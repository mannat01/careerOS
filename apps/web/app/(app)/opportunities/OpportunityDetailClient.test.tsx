import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { opportunityMatchResponseSchema } from '@careeros/contracts';
import { OpportunityDetailClient, type OpportunityDetailDependencies } from './OpportunityDetailClient';
import { POPULATED_MATCH, POPULATED_OPPORTUNITY_DETAIL } from './opportunity-fixtures';

afterEach(cleanup);

function dependencies(): OpportunityDetailDependencies {
  return {
    get: () => Promise.resolve(POPULATED_OPPORTUNITY_DETAIL),
    match: () => Promise.resolve(POPULATED_MATCH),
  };
}

describe('FM3.1 opportunity detail and why-this-fit', () => {
  it('renders the sanitized API payload, complete breakdown, and demanded-but-missing gap', async () => {
    render(<OpportunityDetailClient opportunityId="opportunity-1" dependencies={dependencies()} />);
    expect(await screen.findByRole('heading', { name: 'Staff Backend Engineer' })).toBeVisible();
    expect(screen.getByText(/Gap: Kubernetes is demanded/i)).toBeVisible();
    const breakdown = screen.getByText('Skills Match').closest('dl');
    expect(breakdown).not.toBeNull();
    if (!breakdown) throw new Error('Match score breakdown was not rendered.');
    expect(within(breakdown).getByText('Skills Match')).toBeVisible();
    expect(within(breakdown).getByText('67%')).toBeVisible();
    const payload = screen.getByTestId('sanitized-raw-payload');
    expect(payload).toHaveTextContent('contentSanitized');
    expect(payload).toHaveTextContent('Kubernetes services');
    expect(payload).not.toHaveTextContent('originalRawText');
  });

  it('makes the overall score explanation reachable through WhyPopover', async () => {
    const user = userEvent.setup();
    render(<OpportunityDetailClient opportunityId="opportunity-1" dependencies={dependencies()} />);
    await user.click(await screen.findByRole('button', { name: 'Why this fit' }));
    expect(screen.getByRole('dialog', { name: 'Why: Why this fit' })).toHaveTextContent('Kubernetes is demanded');
    expect(screen.getByTestId('why-evidence-list')).toBeVisible();
  });

  it('renders InsufficientData instead of a bare match number when the breakdown is thin', async () => {
    const thin = opportunityMatchResponseSchema.parse({
      opportunityId: 'opportunity-1', overall: 0, subscores: [], explanation: '', evidenceRefs: [], modelVersion: 'match-scorer@1.0.0',
    });
    render(<OpportunityDetailClient opportunityId="opportunity-1" dependencies={{ ...dependencies(), match: () => Promise.resolve(thin) }} />);
    expect(await screen.findByText(/does not have enough grounded match detail/i)).toBeVisible();
    expect(screen.queryByText('0% match')).not.toBeInTheDocument();
  });
});