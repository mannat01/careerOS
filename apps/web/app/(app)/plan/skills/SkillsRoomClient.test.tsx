import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SkillGapsQuery } from '@careeros/contracts';
import { ApiError } from '@/api';
import { SkillsRoomClient, type SkillsRoomDependencies } from './SkillsRoomClient';
import {
  EMPTY_SKILL_GAPS,
  INSUFFICIENT_SKILL_GAPS,
  POPULATED_SKILL_GAPS,
  SCOPED_SKILL_GAPS,
  SKILLS_OPPORTUNITY,
  SKILLS_OPPORTUNITY_ID,
  SKILLS_PIPELINE,
} from './skills-fixtures';

afterEach(cleanup);

function dependencies(overrides: Partial<SkillsRoomDependencies> = {}): SkillsRoomDependencies {
  return {
    listApplications: () => Promise.resolve(SKILLS_PIPELINE),
    getOpportunity: () => Promise.resolve(SKILLS_OPPORTUNITY),
    getGaps: () => Promise.resolve(POPULATED_SKILL_GAPS),
    ...overrides,
  };
}

describe('FM6.4 Skills room', () => {
  it('loads full analysis by default and offers only GET /v1/applications pipeline opportunities', async () => {
    const listApplications = vi.fn(() => Promise.resolve(SKILLS_PIPELINE));
    const getOpportunity = vi.fn(() => Promise.resolve(SKILLS_OPPORTUNITY));
    const getGaps = vi.fn((_query: SkillGapsQuery) => Promise.resolve(POPULATED_SKILL_GAPS));
    render(<SkillsRoomClient dependencies={dependencies({ listApplications, getOpportunity, getGaps })} />);

    expect(await screen.findByRole('option', { name: 'Platform Engineer · Nimbus' })).toHaveValue(SKILLS_OPPORTUNITY_ID);
    expect(screen.getByRole('option', { name: 'Full analysis · all grounded gaps' })).toHaveValue('');
    expect(listApplications).toHaveBeenCalledOnce();
    expect(getOpportunity).toHaveBeenCalledWith(SKILLS_PIPELINE.data[0]!.opportunityId);
    expect(getGaps).toHaveBeenCalledWith({});
    expect(screen.getByText(/options come only from GET \/v1\/applications/i)).toBeVisible();
  });

  it('renders both gap sources with backend severity and typed grounding, never AiSurface or confidence', async () => {
    render(<SkillsRoomClient dependencies={dependencies()} />);

    const populated = await screen.findByTestId('populated-skill-gaps');
    const perOpportunity = within(populated).getByTestId('skill-gap-per_opp');
    expect(perOpportunity).toHaveTextContent('kubernetes');
    expect(perOpportunity).toHaveTextContent('Severity: high');
    expect(perOpportunity).toHaveTextContent('Source: per_opp · pipeline opportunity');
    expect(perOpportunity).toHaveTextContent('Real role requirementkubernetes');
    expect(perOpportunity).toHaveTextContent('Resolved match subscoreskills: 31 / 100');
    expect(perOpportunity).toHaveTextContent(SKILLS_OPPORTUNITY_ID);

    const aggregate = within(populated).getByTestId('skill-gap-aggregate');
    expect(aggregate).toHaveTextContent('leadership readiness');
    expect(aggregate).toHaveTextContent('Severity: medium');
    expect(aggregate).toHaveTextContent('Source: aggregate · profile and targets');
    expect(aggregate).toHaveTextContent('State dimensionleadership readiness · weak');
    expect(aggregate).toHaveTextContent('Stated target roleEngineering Manager');
    expect(screen.queryByTestId('ai-surface')).not.toBeInTheDocument();
    expect(screen.queryByTestId('confidence-chip')).not.toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
  });

  it('renders analyzed-with-zero-gaps as a good result, not InsufficientData', async () => {
    render(<SkillsRoomClient dependencies={dependencies({ getGaps: () => Promise.resolve(EMPTY_SKILL_GAPS) })} />);

    expect(await screen.findByRole('heading', { name: 'Analyzed — no gaps found' })).toBeVisible();
    expect(screen.getByTestId('skills-analyzed-empty')).toHaveTextContent('good result, not missing data');
    expect(screen.queryByTestId('insufficient-data')).not.toBeInTheDocument();
  });

  it('renders insufficient_data distinctly as not enough to analyze without fabricating a gap', async () => {
    render(<SkillsRoomClient dependencies={dependencies({ getGaps: () => Promise.resolve(INSUFFICIENT_SKILL_GAPS) })} />);

    expect(await screen.findByRole('heading', { name: 'Not enough to analyze' })).toBeVisible();
    expect(screen.getByTestId('insufficient-data')).toHaveTextContent(/profile and pipeline do not yet contain enough real signal/i);
    expect(screen.queryByTestId('skills-analyzed-empty')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Grounded skill gaps' })).not.toBeInTheDocument();
  });

  it('requests an owned opportunity-scoped view and can return to the default full view', async () => {
    const getGaps = vi.fn((query: SkillGapsQuery) => Promise.resolve(
      query.opportunityId ? SCOPED_SKILL_GAPS : POPULATED_SKILL_GAPS,
    ));
    const user = userEvent.setup();
    render(<SkillsRoomClient dependencies={dependencies({ getGaps })} />);

    const picker = await screen.findByRole('combobox', { name: 'Pipeline opportunity' });
    await user.selectOptions(picker, SKILLS_OPPORTUNITY_ID);
    expect(getGaps).toHaveBeenLastCalledWith({ opportunityId: SKILLS_OPPORTUNITY_ID });
    const scoped = await screen.findByRole('list', { name: 'Grounded skill gaps' });
    expect(within(scoped).getAllByRole('listitem')).toHaveLength(1);
    expect(within(scoped).getByTestId('skill-gap-per_opp')).toBeVisible();
    expect(within(scoped).queryByTestId('skill-gap-aggregate')).not.toBeInTheDocument();

    await user.selectOptions(picker, '');
    expect(getGaps).toHaveBeenLastCalledWith({});
    expect(await screen.findByTestId('skill-gap-aggregate')).toBeVisible();
  });

  it('recovers an opportunity_not_owned denial through pipeline reload/review, never approval', async () => {
    const getGaps = vi.fn((query: SkillGapsQuery) => query.opportunityId
      ? Promise.reject(new ApiError({
          code: 'capability_denied',
          status: 403,
          message: 'You can only analyze an opportunity saved in your pipeline.',
          details: { opportunityId: SKILLS_OPPORTUNITY_ID, reason: 'opportunity_not_owned' },
        }))
      : Promise.resolve(POPULATED_SKILL_GAPS));
    const user = userEvent.setup();
    render(<SkillsRoomClient dependencies={dependencies({ getGaps })} />);

    await user.selectOptions(await screen.findByLabelText('Pipeline opportunity'), SKILLS_OPPORTUNITY_ID);
    const recovery = await screen.findByTestId('skills-not-owned-recovery');
    expect(recovery).toHaveTextContent('no longer in your pipeline');
    expect(within(recovery).getByRole('button', { name: 'Reload pipeline opportunities' })).toBeVisible();
    expect(within(recovery).getByRole('link', { name: 'Review pipeline' })).toHaveAttribute('href', '/opportunities/pipeline');
    expect(screen.queryByRole('button', { name: /approve|request approval/i })).not.toBeInTheDocument();
  });

  it.each([
    ['not_found', 404, 'Profile not found.'],
    ['validation_failed', 422, 'opportunityId must be a UUID when provided.'],
  ] as const)('provides typed retry, reload, and pipeline recovery for %s', async (code, status, message) => {
    const getGaps = vi.fn((query: SkillGapsQuery) => query.opportunityId
      ? Promise.reject(new ApiError({ code, status, message }))
      : Promise.resolve(POPULATED_SKILL_GAPS));
    const user = userEvent.setup();
    render(<SkillsRoomClient dependencies={dependencies({ getGaps })} />);

    await user.selectOptions(await screen.findByLabelText('Pipeline opportunity'), SKILLS_OPPORTUNITY_ID);
    expect(await screen.findByTestId('error-recovery')).toHaveAttribute('data-code', code);
    expect(screen.getByRole('button', { name: 'Reload Skills room' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Choose from pipeline' })).toHaveAttribute('href', '/opportunities/pipeline');
  });

  it('is advisory-only: links to action rooms and exposes no inline Green, Yellow, or Red action', async () => {
    render(<SkillsRoomClient dependencies={dependencies()} />);
    await screen.findByTestId('populated-skill-gaps');

    expect(screen.getByText('Skills is advisory and executes no Green, Yellow, or Red action inline.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open You' })).toHaveAttribute('href', '/you');
    expect(screen.getByRole('link', { name: 'Open Plan' })).toHaveAttribute('href', '/plan');
    expect(screen.getByRole('link', { name: 'Open Opportunities' })).toHaveAttribute('href', '/opportunities');
    expect(screen.queryByRole('button', { name: /generate|start|update|send|submit|approve|execute/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('[data-tier="green"], [data-tier="yellow"], [data-tier="red"]')).toBeNull();
  });
});