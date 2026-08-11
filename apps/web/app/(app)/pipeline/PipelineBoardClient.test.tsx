import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Application, ApplicationDetail, ApplicationPatchRequest } from '@careeros/contracts';
import { ApiError } from '@/api';
import {
  PipelineBoardClient,
  PIPELINE_STAGES,
  ordinaryMoveTargets,
  type PipelineDependencies,
} from './PipelineBoardClient';
import { EMPTY_PIPELINE, POPULATED_PIPELINE, makeApplication } from './pipeline-fixtures';

afterEach(cleanup);

function asDetail(application: Application): ApplicationDetail {
  return {
    ...application,
    timeline: [{
      id: `timeline-${application.id}`,
      fromStatus: null,
      toStatus: application.status,
      actor: 'user',
      note: null,
      at: application.updatedAt,
    }],
  };
}

function successfulDependencies(): PipelineDependencies {
  return {
    list: () => Promise.resolve(POPULATED_PIPELINE),
    patch: (id, body) => {
      const application = POPULATED_PIPELINE.data.find((candidate) => candidate.id === id);
      if (!application || !body.status) return Promise.reject(new Error('Missing application/status fixture.'));
      return Promise.resolve(asDetail({
        ...application,
        status: body.status,
        appliedAt: body.status === 'applied' ? '2026-08-11T13:00:00.000Z' : application.appliedAt,
        updatedAt: '2026-08-11T13:00:00.000Z',
      }));
    },
  };
}

function column(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

describe('FM3.3 application pipeline board', () => {
  it('renders the complete canonical eight-stage board', async () => {
    render(<PipelineBoardClient dependencies={successfulDependencies()} />);
    await screen.findByTestId('pipeline-board');

    expect(PIPELINE_STAGES).toEqual([
      'saved', 'drafting', 'ready', 'applied', 'screening', 'interviewing', 'offer', 'closed',
    ]);
    for (const label of ['Saved', 'Drafting', 'Ready', 'Applied', 'Screening', 'Interviewing', 'Offer', 'Closed']) {
      expect(screen.getByRole('heading', { name: label })).toBeVisible();
    }
    expect(within(column('Saved')).getByText(/00000000-0000-4000-8000-000000000022/)).toBeVisible();
  });

  it('moves an ordinary stage optimistically, then keeps server truth', async () => {
    let resolvePatch: ((value: ApplicationDetail) => void) | undefined;
    const patch = vi.fn((_id: string, _body: ApplicationPatchRequest) =>
      new Promise<ApplicationDetail>((resolve) => { resolvePatch = resolve; }),
    );
    const user = userEvent.setup();
    render(<PipelineBoardClient dependencies={{ list: () => Promise.resolve(POPULATED_PIPELINE), patch }} />);

    const savedCard = await screen.findByTestId('pipeline-card-app-1');
    await user.click(within(savedCard).getByRole('button', { name: 'Move to Drafting' }));

    expect(patch).toHaveBeenCalledWith('app-1', { status: 'drafting' });
    expect(within(column('Drafting')).getByTestId('pipeline-card-app-1')).toBeVisible();

    const serverApplication = makeApplication({
      id: 'app-1',
      opportunityId: POPULATED_PIPELINE.data[0]!.opportunityId,
      status: 'drafting',
      notes: 'server truth',
    });
    resolvePatch?.(asDetail(serverApplication));
    expect(await within(column('Drafting')).findByTestId('pipeline-card-app-1')).toBeVisible();
  });

  it('rolls back an invalid transition and shows the typed 409 conflict honestly', async () => {
    const patch = vi.fn(() => Promise.reject(new ApiError({
      code: 'conflict',
      status: 409,
      message: 'Invalid status transition.',
      details: { from: 'saved', to: 'drafting', reason: 'not_adjacent' },
    })));
    const user = userEvent.setup();
    render(<PipelineBoardClient dependencies={{ list: () => Promise.resolve(POPULATED_PIPELINE), patch }} />);

    await user.click(within(await screen.findByTestId('pipeline-card-app-1')).getByRole('button', { name: 'Move to Drafting' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid status transition.');
    expect(screen.getByTestId('error-recovery')).toHaveAttribute('data-code', 'conflict');
    expect(within(column('Saved')).getByTestId('pipeline-card-app-1')).toBeVisible();
    expect(within(column('Drafting')).queryByTestId('pipeline-card-app-1')).not.toBeInTheDocument();
  });

  it('never offers applied as an ordinary move target', () => {
    expect(ordinaryMoveTargets('ready')).not.toContain('applied');
    expect(ordinaryMoveTargets('ready')).toEqual(['closed']);
    expect(ordinaryMoveTargets('drafting')).toEqual(['ready', 'closed']);
  });

  it('only the distinct checked confirmation sends the explicit applied flag', async () => {
    const patch = vi.fn((id: string, body: ApplicationPatchRequest) => {
      const current = POPULATED_PIPELINE.data.find((application) => application.id === id);
      if (!current || body.status !== 'applied') return Promise.reject(new Error('Unexpected patch.'));
      return Promise.resolve(asDetail({
        ...current,
        status: 'applied',
        appliedAt: '2026-08-11T13:00:00.000Z',
      }));
    });
    const user = userEvent.setup();
    render(<PipelineBoardClient dependencies={{ list: () => Promise.resolve(POPULATED_PIPELINE), patch }} />);

    const readyCard = await screen.findByTestId('pipeline-card-app-2');
    expect(within(readyCard).queryByRole('button', { name: 'Move to Applied' })).not.toBeInTheDocument();
    await user.click(within(readyCard).getByRole('button', { name: 'I applied to this myself' }));

    const dialog = screen.getByRole('dialog', { name: 'Confirm your application' });
    const confirm = within(dialog).getByRole('button', { name: 'Confirm I applied' });
    expect(confirm).toBeDisabled();
    expect(patch).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('checkbox', { name: 'I applied to this myself' }));
    await user.click(confirm);

    expect(patch).toHaveBeenCalledOnce();
    expect(patch).toHaveBeenCalledWith('app-2', { status: 'applied', iSubmitted: true });
    expect(await within(column('Applied')).findByTestId('pipeline-card-app-2')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Confirm your application' })).not.toBeInTheDocument();
  });

  it('renders an honest empty pipeline with a path to save an opportunity', async () => {
    render(<PipelineBoardClient dependencies={{
      list: () => Promise.resolve(EMPTY_PIPELINE),
      patch: () => Promise.reject(new Error('Empty pipeline cannot move.')),
    }} />);

    expect(await screen.findByRole('heading', { name: 'Your pipeline is empty' })).toBeVisible();
    expect(screen.getByText(/will not invent an application or mark one applied/i)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Browse opportunities and save one' })).toHaveAttribute('href', '/opportunities');
  });
});