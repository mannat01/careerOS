import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import {
  applicationListResponseSchema,
  briefingLatestResponseSchema,
  pendingApprovalListResponseSchema,
} from '@careeros/contracts';
import { ApiError } from '@/api';
import { TodayRoomClient, type TodayRoomDependencies } from './TodayRoomClient';

const NOW = '2026-08-12T12:00:00.000Z';
const USER_ID = '00000000-0000-4000-8000-000000000001';

const APPROVALS = pendingApprovalListResponseSchema.parse({
  data: [
    { id: 'approval-1', action: 'briefing.item.execute', why: 'Review the exact prepared draft.', payload: { body: 'Draft one' }, tier: 'yellow', resourceRefs: [{ type: 'briefing_run', id: 'briefing-1' }], state: 'proposed', createdAt: NOW },
    { id: 'approval-2', action: 'portfolio.publish', why: 'Publishing changes the public portfolio.', payload: { slug: 'dev' }, tier: 'yellow', resourceRefs: [{ type: 'portfolio', id: 'portfolio-1' }], state: 'approved', createdAt: NOW },
  ],
});

const BRIEFING = briefingLatestResponseSchema.parse({
  id: 'briefing-1', userId: USER_ID, trigger: 'scheduled', status: 'complete', inputs: {}, steps: [], costTotal: 0.01, startedAt: NOW, finishedAt: NOW,
  items: [{
    id: 'item-1', kind: 'focus', refId: null, autonomyTier: 'green', state: 'proposed',
    payload: { recommendation: 'Review the grounded TypeScript role.', reasoning: 'Profile evidence matches.', confidence: 0.82, evidenceRefs: ['experience:typescript'], modelVersion: 'strategic-reasoner@fake' },
    action: 'briefing.generate', why: 'Returned by the grounded strategic reasoner.', resourceRefs: [{ type: 'briefing_run', id: 'briefing-1' }], createdAt: NOW,
  }],
});

const APPLICATIONS = applicationListResponseSchema.parse({
  data: [
    { id: 'app-1', opportunityId: 'opportunity-1', resumeVariantId: null, status: 'saved', notes: null, followUpAt: '2026-08-13T12:00:00.000Z', appliedAt: null, createdAt: NOW, updatedAt: NOW },
    { id: 'app-2', opportunityId: 'opportunity-2', resumeVariantId: null, status: 'interviewing', notes: null, followUpAt: null, appliedAt: NOW, createdAt: NOW, updatedAt: NOW },
  ],
});

function dependencies(overrides: Partial<TodayRoomDependencies> = {}): TodayRoomDependencies {
  return {
    pendingApprovals: () => Promise.resolve(APPROVALS),
    latestBriefing: () => Promise.resolve(BRIEFING),
    applications: () => Promise.resolve(APPLICATIONS),
    ...overrides,
  };
}

afterEach(cleanup);

describe('FM5.2 Today room', () => {
  it('renders all three populated endpoint-backed cards and no inline action execution', async () => {
    const deps = dependencies({
      pendingApprovals: vi.fn(() => Promise.resolve(APPROVALS)),
      latestBriefing: vi.fn(() => Promise.resolve(BRIEFING)),
      applications: vi.fn(() => Promise.resolve(APPLICATIONS)),
    });
    render(<TodayRoomClient dependencies={deps} />);

    const approvals = await screen.findByTestId('today-card-approvals');
    expect(within(approvals).getByTestId('pending-approval-count')).toHaveTextContent('2');
    expect(approvals).toHaveTextContent('briefing.item.execute');
    expect(approvals).toHaveTextContent('Review the exact prepared draft.');
    expect(within(approvals).getByRole('link', { name: 'Open Approvals' })).toHaveAttribute('href', '/approvals');

    const digest = screen.getByTestId('today-card-digest');
    expect(within(digest).getByText('Review the grounded TypeScript role.')).toBeVisible();
    const aiSurface = within(digest).getByTestId('ai-surface');
    expect(aiSurface).toHaveAttribute('data-evidence-count', '1');
    expect(aiSurface).toHaveAttribute('data-confidence-band', 'high');
    expect(aiSurface).toHaveAttribute('data-confidence-source', 'strategic-reasoner@fake');

    const pipeline = screen.getByTestId('today-card-pipeline');
    const counts = within(pipeline).getByRole('group', { name: 'Application counts by stage' });
    expect(within(counts).getByText('Saved').nextElementSibling).toHaveTextContent('1');
    expect(within(counts).getByText('Interviewing').nextElementSibling).toHaveTextContent('1');
    expect(pipeline).toHaveTextContent('Follow up on opportunity opportunity-1');
    expect(within(pipeline).getByRole('link', { name: 'Open pipeline board' })).toHaveAttribute('href', '/opportunities/pipeline');

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(deps.pendingApprovals).toHaveBeenCalledOnce();
    expect(deps.latestBriefing).toHaveBeenCalledOnce();
    expect(deps.applications).toHaveBeenCalledOnce();
  });

  it('renders the exact approvals empty state', async () => {
    render(<TodayRoomClient dependencies={dependencies({ pendingApprovals: () => Promise.resolve(pendingApprovalListResponseSchema.parse({ data: [] })) })} />);
    expect(await screen.findByText('Nothing is waiting for your decision.')).toBeVisible();
  });

  it('renders the honest no-briefing-items empty state', async () => {
    const empty = briefingLatestResponseSchema.parse({ ...BRIEFING, items: [] });
    render(<TodayRoomClient dependencies={dependencies({ latestBriefing: () => Promise.resolve(empty) })} />);
    expect(await screen.findByRole('heading', { name: 'No briefing yet' })).toBeVisible();
    expect(screen.getByText(/will not invent a digest/i)).toBeVisible();
  });

  it('renders the honest pipeline empty state with a browse/save path', async () => {
    render(<TodayRoomClient dependencies={dependencies({ applications: () => Promise.resolve(applicationListResponseSchema.parse({ data: [] })) })} />);
    expect(await screen.findByRole('heading', { name: 'Your pipeline is empty' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Browse opportunities and save one' })).toHaveAttribute('href', '/opportunities');
  });

  it('uses InsufficientData rather than rendering an ungrounded briefing summary', async () => {
    const thin = briefingLatestResponseSchema.parse({
      ...BRIEFING,
      items: [{ ...BRIEFING.items[0], payload: { summary: 'Unsupported legacy summary.' } }],
    });
    render(<TodayRoomClient dependencies={dependencies({ latestBriefing: () => Promise.resolve(thin) })} />);
    expect(await screen.findByRole('heading', { name: 'Briefing item lacks displayable grounding' })).toBeVisible();
    expect(screen.queryByText('Unsupported legacy summary.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-surface')).not.toBeInTheDocument();
  });

  it('keeps two cards populated when one card fails and shows its typed recovery', async () => {
    render(<TodayRoomClient dependencies={dependencies({
      latestBriefing: () => Promise.reject(new ApiError({ code: 'internal', message: 'Briefing dependency failed.', traceId: 'trace-today' })),
    })} />);

    expect(await screen.findByTestId('pending-approval-count')).toHaveTextContent('2');
    expect(screen.getByTestId('today-card-pipeline')).toHaveTextContent('Follow up on opportunity opportunity-1');
    const digest = screen.getByTestId('today-card-digest');
    expect(within(digest).getByTestId('error-recovery')).toHaveAttribute('data-code', 'internal');
    expect(within(digest).getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('is axe-clean with all three cards populated', async () => {
    const { container } = render(<TodayRoomClient dependencies={dependencies()} />);
    await screen.findByTestId('pending-approval-count');
    expect(await axe(container)).toHaveNoViolations();
  });
});