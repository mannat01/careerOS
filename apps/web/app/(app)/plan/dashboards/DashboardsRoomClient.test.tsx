import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardMetricKey } from '@careeros/contracts';
import { ApiError } from '@/api';
import { DashboardsRoomClient, type DashboardsRoomDependencies } from './DashboardsRoomClient';
import {
  CAREER_MOMENTUM_DETAIL,
  POPULATED_DASHBOARD,
  THIN_DASHBOARD,
  detailFor,
} from './dashboard-fixtures';

afterEach(cleanup);

function dependencies(overrides: Partial<DashboardsRoomDependencies> = {}): DashboardsRoomDependencies {
  return {
    list: () => Promise.resolve(POPULATED_DASHBOARD),
    detail: (key) => {
      const metric = POPULATED_DASHBOARD.metrics.find((candidate) => candidate.metric === key);
      if (!metric) return Promise.reject(new Error(`Missing fixture metric ${key}`));
      return Promise.resolve(detailFor(metric));
    },
    ...overrides,
  };
}

describe('FM6.5 Dashboards room', () => {
  it('renders all ten parsed scored metrics in AiSurface with exact response values, trends, confidence, explanations, and freshness', async () => {
    render(<DashboardsRoomClient dependencies={dependencies()} />);

    const list = await screen.findByRole('list', { name: 'Intelligence dashboard metrics' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    expect(within(list).getAllByTestId('ai-surface')).toHaveLength(10);
    expect(within(list).getAllByTestId('confidence-chip')).toHaveLength(10);

    const career = within(list).getByTestId('metric-card-career_momentum');
    expect(career).toHaveTextContent('72');
    expect(career).toHaveTextContent('rising');
    expect(career).toHaveTextContent('Backend explanation for career_momentum.');
    expect(career).toHaveTextContent('Aug 21, 2026, 12:00 PM UTC');
    expect(within(career).getByTestId('ai-surface')).toHaveAttribute('data-evidence-count', '1');
    expect(within(career).getByTestId('ai-surface')).toHaveAttribute('data-confidence-source', 'metric-composer@fake-grounded');
    expect(within(career).getByTestId('confidence-value')).toHaveTextContent('61%');
  });

  it('renders insufficient_data without a score, trend, AiSurface, or ConfidenceChip and keeps a real low score distinct', async () => {
    render(<DashboardsRoomClient dependencies={dependencies({ list: () => Promise.resolve(THIN_DASHBOARD) })} />);

    const thin = await screen.findByTestId('metric-card-interview_readiness');
    expect(within(thin).getByRole('heading', { name: 'Interview readiness: not enough signal yet' })).toBeVisible();
    expect(thin).toHaveTextContent('No interview outcomes are available yet.');
    expect(within(thin).queryByTestId('ai-surface')).not.toBeInTheDocument();
    expect(within(thin).queryByTestId('confidence-chip')).not.toBeInTheDocument();
    expect(thin).not.toHaveTextContent('27%');
    expect(thin).not.toHaveTextContent('Backend trend');

    const low = screen.getByTestId('metric-card-networking_strength');
    expect(within(low).getByTestId('ai-surface')).toBeVisible();
    expect(low).toHaveTextContent('47');
    expect(within(low).getByTestId('confidence-chip')).toBeVisible();
  });

  it('opens contract-parsed metric detail and renders resolved evidence from the detail endpoint', async () => {
    const detail = vi.fn((key: DashboardMetricKey) => key === 'career_momentum'
      ? Promise.resolve(CAREER_MOMENTUM_DETAIL)
      : Promise.reject(new Error('Unexpected detail key')));
    const user = userEvent.setup();
    render(<DashboardsRoomClient dependencies={dependencies({ detail })} />);

    const card = await screen.findByTestId('metric-card-career_momentum');
    const open = within(card).getByRole('button', { name: 'View resolved evidence for Career momentum' });
    open.focus();
    await user.keyboard('{Enter}');

    const evidence = await within(card).findByRole('list', { name: 'Career momentum resolved evidence' });
    expect(evidence).toHaveTextContent('Shipped two caller-recorded portfolio projects.');
    expect(evidence).toHaveTextContent('Profile fact · profile-fact-1');
    expect(detail).toHaveBeenCalledWith('career_momentum');
  });

  it('keeps a typed detail 404 inside one card with retry while the other nine cards remain available', async () => {
    const detail = vi.fn(() => Promise.reject(new ApiError({
      code: 'not_found',
      status: 404,
      message: 'Metric not yet computed for this profile.',
      traceId: 'trace-dashboard-detail',
    })));
    const user = userEvent.setup();
    render(<DashboardsRoomClient dependencies={dependencies({ detail })} />);

    const failedCard = await screen.findByTestId('metric-card-career_momentum');
    await user.click(within(failedCard).getByRole('button', { name: 'View resolved evidence for Career momentum' }));
    const recovery = await within(failedCard).findByTestId('error-recovery');
    expect(recovery).toHaveAttribute('data-code', 'not_found');
    expect(within(failedCard).getByRole('button', { name: 'Retry this metric detail' })).toBeVisible();
    expect(screen.getByTestId('metric-card-skill_momentum')).toBeVisible();
    expect(screen.getAllByTestId('metric-card-career_momentum')).toHaveLength(1);
    expect(screen.getAllByTestId(/metric-card-/)).toHaveLength(10);
  });

  it('fails typed on list-shape drift instead of rendering unparsed numbers', async () => {
    const drifted = {
      ...POPULATED_DASHBOARD,
      metrics: [{ ...POPULATED_DASHBOARD.metrics[0], value: 999 }],
    } as unknown as typeof POPULATED_DASHBOARD;
    render(<DashboardsRoomClient dependencies={dependencies({ list: () => Promise.resolve(drifted) })} />);

    const recovery = await screen.findByTestId('error-recovery');
    expect(recovery).toHaveAttribute('data-code', 'internal');
    expect(screen.queryByText('999')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Intelligence dashboard metrics' })).not.toBeInTheDocument();
  });

  it('is navigation-only: linkedAction is a link and no inline Green, Yellow, or Red execution exists', async () => {
    render(<DashboardsRoomClient dependencies={dependencies()} />);

    const card = await screen.findByTestId('metric-card-career_momentum');
    expect(within(card).getByRole('link', { name: 'Open linked plan action: Publish a portfolio case study' }))
      .toHaveAttribute('href', '/plan#plan-action-action-1');
    expect(screen.getByText('Dashboards is advisory and executes no Green, Yellow, or Red action inline.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /generate|start|update|send|submit|approve|execute/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(Object.keys(dependencies())).toEqual(['list', 'detail']);
  });
});