import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { decisionSupportResponseSchema, opportunityMatchResponseSchema } from '@careeros/contracts';
import { OpportunityDetailClient, type OpportunityDetailDependencies } from './OpportunityDetailClient';
import { POPULATED_MATCH, POPULATED_OPPORTUNITY_DETAIL } from './opportunity-fixtures';

afterEach(cleanup);

function dependencies(): OpportunityDetailDependencies {
  return {
    get: () => Promise.resolve(POPULATED_OPPORTUNITY_DETAIL),
    match: () => Promise.resolve(POPULATED_MATCH),
    decide: () => Promise.resolve(decisionSupportResponseSchema.parse({
      alternatives: ['apply now', 'hold / not yet'],
      evidenceRefs: ['experience:experience-1'],
      reasoning: 'The demonstrated scope does not yet meet the stated seniority.',
      confidence: 0.3,
      assumptions: ['The stated seniority requirement is accurate.'],
      recommendation: 'hold / not yet',
      optionalityNote: 'Build broader leadership scope, then revisit.',
      modelVersion: 'strategic-reasoner@1.0.0',
    })),
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

describe('FM3.2 should-I-apply decision support', () => {
  it('renders the full contract in order, preserves an honest hold, and remains advice only', async () => {
    const user = userEvent.setup();
    const deps = dependencies();
    render(<OpportunityDetailClient opportunityId="opportunity-1" dependencies={deps} />);
    await user.click(await screen.findByRole('button', { name: 'Should I apply?' }));

    const card = await screen.findByRole('region', { name: 'Should I apply decision support' });
    expect(card).toHaveTextContent('This is advice — you decide.');
    expect(card).toHaveTextContent('will not apply, submit, or take any action');
    expect(within(card).getByTestId('decision-recommendation')).toHaveTextContent('hold / not yet');
    expect(within(card).getByTestId('confidence-chip')).toHaveTextContent('30%');
    expect(within(card).getByText('Build broader leadership scope, then revisit.')).toBeVisible();

    const headings = within(card).getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      'Alternatives considered', 'Evidence', 'Reasoning', 'Calibrated confidence',
      'Assumptions', 'Recommendation', 'Optionality note',
    ]);

    await user.click(within(card).getByRole('button', { name: 'Why this advice' }));
    expect(screen.getByRole('dialog', { name: 'Why: Decision evidence' })).toHaveTextContent('experience:experience-1');
  });

  it('never renders a bare verdict when the complete response is thin', async () => {
    const user = userEvent.setup();
    const thin = decisionSupportResponseSchema.parse({
      alternatives: [], evidenceRefs: [], reasoning: '', confidence: 0,
      assumptions: [], recommendation: '',
    });
    render(<OpportunityDetailClient opportunityId="opportunity-1" dependencies={{
      ...dependencies(), decide: () => Promise.resolve(thin),
    }} />);
    await user.click(await screen.findByRole('button', { name: 'Should I apply?' }));

    const card = await screen.findByRole('region', { name: 'Should I apply decision support' });
    expect(within(card).getAllByTestId('insufficient-data')).toHaveLength(6);
    expect(within(card).getByRole('heading', { name: 'Calibrated confidence' })).toBeVisible();
    expect(within(card).getByTestId('confidence-chip')).toHaveTextContent('Low');
    expect(within(card).queryByTestId('decision-recommendation')).not.toBeInTheDocument();
    expect(card).toHaveTextContent('will not fill it in or infer a verdict');
  });
});