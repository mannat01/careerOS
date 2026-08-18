import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api';
import { PlanRoomClient, type PlanRoomDependencies } from './PlanRoomClient';
import { PARTIALLY_GROUNDED_PLAN, POPULATED_PLAN, THIN_PLAN } from './plan-fixtures';

afterEach(cleanup);

function dependencies(overrides: Partial<PlanRoomDependencies> = {}): PlanRoomDependencies {
  return {
    getPlans: () => Promise.resolve(POPULATED_PLAN),
    ...overrides,
  };
}

describe('FM6.2 Plan room', () => {
  it('renders populated grounded plans with contract provenance and backend dates', async () => {
    render(<PlanRoomClient dependencies={dependencies()} />);

    const room = await screen.findByTestId('populated-plan');
    const today = within(room).getByTestId('grounded-todays-move');
    expect(today).toHaveTextContent('Complete the reliability project already in your profile.');
    expect(today).toHaveTextContent('goal:career_goals:0');
    expect(today).toHaveTextContent('node:project:reliability');

    const plan30d = within(room).getByTestId('horizon-plan-30d');
    expect(plan30d).toHaveTextContent('Build evidence toward your stated platform-engineering goal.');
    expect(plan30d).toHaveTextContent('Updated Aug 17, 2026');
    expect(plan30d).toHaveTextContent('created Aug 16, 2026');
    expect(plan30d).toHaveTextContent('post-guardrail model strategic-planner@fake-grounded');
    expect(plan30d).toHaveTextContent('40% recorded');

    const plan90d = within(room).getByTestId('horizon-plan-90d');
    expect(plan90d).toHaveTextContent('Moved pipeline review earlier after a material state change.');
    expect(plan90d).toHaveTextContent('node:role:platform');

    expect(screen.queryByTestId('ai-surface')).not.toBeInTheDocument();
    expect(screen.queryByTestId('confidence-chip')).not.toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
  });

  it('renders the no-plan contract branch as InsufficientData without fabricating an item', async () => {
    render(<PlanRoomClient dependencies={dependencies({ getPlans: () => Promise.resolve(THIN_PLAN) })} />);

    expect(await screen.findByRole('heading', { name: 'Not enough grounded state for a plan' })).toBeVisible();
    expect(screen.getByText('No active plan is available yet.')).toBeVisible();
    expect(screen.queryByTestId('populated-plan')).not.toBeInTheDocument();
    expect(screen.queryByText(/streak|deadline|due date/i)).not.toBeInTheDocument();
  });

  it('hides a generated action and today move when the contract carries no action grounding', async () => {
    render(<PlanRoomClient dependencies={dependencies({ getPlans: () => Promise.resolve(PARTIALLY_GROUNDED_PLAN) })} />);

    expect(await screen.findByRole('heading', { name: 'No grounded move for today' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Action 1 has no grounding' })).toBeVisible();
    expect(screen.queryByText('This generated title must not render.')).not.toBeInTheDocument();
    expect(screen.queryByText('This rationale must not render without grounding.')).not.toBeInTheDocument();
  });

  it('gives an endpoint failure its typed retry recovery without removing room navigation', async () => {
    const getPlans = vi
      .fn<PlanRoomDependencies['getPlans']>()
      .mockRejectedValueOnce(new ApiError({
        code: 'internal',
        status: 500,
        message: 'Planner read model unavailable.',
        traceId: 'trace-plan-room',
      }))
      .mockResolvedValueOnce(POPULATED_PLAN);
    const user = userEvent.setup();
    render(<PlanRoomClient dependencies={dependencies({ getPlans })} />);

    const recovery = await screen.findByTestId('error-recovery');
    expect(recovery).toHaveAttribute('data-code', 'internal');
    expect(recovery).toHaveTextContent('trace-plan-room');
    expect(screen.getByRole('link', { name: 'Open Opportunities' })).toBeVisible();
    await user.click(within(recovery).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('populated-plan')).toBeVisible();
    expect(getPlans).toHaveBeenCalledTimes(2);
  });

  it('is navigation-only: links to action rooms and exposes no inline action execution', async () => {
    const getPlans = vi.fn(() => Promise.resolve(POPULATED_PLAN));
    render(<PlanRoomClient dependencies={{ getPlans }} />);

    await screen.findByTestId('populated-plan');
    expect(getPlans).toHaveBeenCalledOnce();
    expect(screen.getByText('Plan is advisory and executes no Green, Yellow, or Red action inline.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Opportunities' })).toHaveAttribute('href', '/opportunities');
    expect(screen.getByRole('link', { name: 'Open You' })).toHaveAttribute('href', '/you');
    expect(screen.getByRole('link', { name: 'Open Approvals' })).toHaveAttribute('href', '/approvals');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(Object.keys(dependencies())).toEqual(['getPlans']);
  });
});