import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResumeTailorRequest } from '@careeros/contracts';
import { ApiError } from '@/api';
import { AtsCheckPanel } from './AtsCheckPanel';
import { ResumeStudioClient, type ResumeStudioDependencies } from './ResumeStudioClient';
import {
  BASE_RESUME,
  GROUNDED_VARIANT,
  RESUME_OPPORTUNITY,
  RESUME_OPPORTUNITY_ID,
  RESUME_PIPELINE,
  THIN_VARIANT,
} from './resume-fixtures';

afterEach(cleanup);

function dependencies(overrides: Partial<ResumeStudioDependencies> = {}): ResumeStudioDependencies {
  return {
    getBase: () => Promise.resolve(BASE_RESUME),
    listApplications: () => Promise.resolve(RESUME_PIPELINE),
    getOpportunity: () => Promise.resolve(RESUME_OPPORTUNITY),
    tailor: () => Promise.resolve(GROUNDED_VARIANT),
    getVariant: () => Promise.resolve(GROUNDED_VARIANT),
    ...overrides,
  };
}

describe('FM4 résumé studio', () => {
  it('loads the structured base and offers only caller pipeline opportunities', async () => {
    const getOpportunity = vi.fn(() => Promise.resolve(RESUME_OPPORTUNITY));
    render(<ResumeStudioClient dependencies={dependencies({ getOpportunity })} />);

    expect(await screen.findByRole('heading', { name: 'Base résumé' })).toBeVisible();
    expect(screen.getByText('Built reliable TypeScript services.')).toBeVisible();
    expect(screen.getByText('Profile fact: experience:1')).toBeVisible();
    expect(screen.getByText(/built from your real experience/i)).toBeVisible();
    expect(screen.getByRole('option', { name: 'Staff Backend Engineer · Helios Labs' })).toHaveValue(RESUME_OPPORTUNITY_ID);
    expect(getOpportunity).toHaveBeenCalledOnce();
    expect(getOpportunity).toHaveBeenCalledWith(RESUME_PIPELINE.data[0]!.opportunityId);
  });

  it('completes the full tailor flow, retrieves server truth, and renders content, diff, rationale, and ATS warnings', async () => {
    const tailor = vi.fn((_resumeId: string, _body: ResumeTailorRequest) => Promise.resolve(GROUNDED_VARIANT));
    const getVariant = vi.fn(() => Promise.resolve(GROUNDED_VARIANT));
    const user = userEvent.setup();
    render(<ResumeStudioClient dependencies={dependencies({ tailor, getVariant })} />);

    const action = await screen.findByRole('button', { name: 'Tailor résumé draft' });
    await user.click(action);

    expect(tailor).toHaveBeenCalledWith(BASE_RESUME.id, { opportunityId: RESUME_OPPORTUNITY_ID });
    expect(getVariant).toHaveBeenCalledWith(GROUNDED_VARIANT.id);
    const variant = await screen.findByTestId('resume-variant');
    expect(within(variant).getByRole('heading', { name: 'Tailored content' })).toBeVisible();
    expect(within(within(variant).getByRole('list', { name: 'Grounded tailored bullets' })).getByText(GROUNDED_VARIANT.bullets[0]!.text)).toBeVisible();
    expect(within(variant).getByRole('heading', { name: 'What changed vs. base' })).toBeVisible();
    expect(within(variant).getByText(/selected the real experience fact/i)).toBeVisible();
    expect(within(variant).getByTestId('ats-check-panel')).toHaveTextContent('Use standard section headings for safer parsing.');
    expect(within(variant).getByText('Built from your real experience. This is a draft. Nothing was sent or submitted.')).toBeVisible();
  });

  it('renders the fake model zero-bullet response honestly without inventing content, diff, or rationale', async () => {
    const user = userEvent.setup();
    render(<ResumeStudioClient dependencies={dependencies({
      tailor: () => Promise.resolve(THIN_VARIANT),
      getVariant: () => Promise.resolve(THIN_VARIANT),
    })} />);

    await user.click(await screen.findByRole('button', { name: 'Tailor résumé draft' }));
    const variant = await screen.findByTestId('resume-variant');
    expect(within(variant).getByRole('heading', { name: 'No grounded tailored content returned' })).toBeVisible();
    expect(within(variant).getByRole('heading', { name: 'No changes returned' })).toBeVisible();
    expect(within(variant).getByRole('heading', { name: 'No rationale returned' })).toBeVisible();
    expect(within(variant).queryByRole('list', { name: 'Grounded tailored bullets' })).not.toBeInTheDocument();
  });

  it('renders base insufficient_data with onboarding/profile recovery and no placeholder résumé', async () => {
    render(<ResumeStudioClient dependencies={dependencies({
      getBase: () => Promise.reject(new ApiError({
        code: 'validation_failed', status: 422, message: 'Not enough profile facts.',
        details: { status: 'insufficient_data' },
      })),
    })} />);

    expect(await screen.findByRole('heading', { name: 'Your base résumé needs more profile facts' })).toBeVisible();
    expect(screen.getByText(/no placeholder résumé was created/i)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Return to onboarding and import your résumé' })).toHaveAttribute('href', '/onboarding');
    expect(screen.queryByRole('heading', { name: 'Base résumé' })).not.toBeInTheDocument();
  });

  it('renders an honest empty picker when the pipeline has no applications', async () => {
    render(<ResumeStudioClient dependencies={dependencies({
      listApplications: () => Promise.resolve({ data: [] }),
    })} />);
    expect(await screen.findByRole('heading', { name: 'No pipeline opportunity to tailor against' })).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Pipeline opportunity' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open your pipeline' })).toHaveAttribute('href', '/opportunities/pipeline');
  });

  it('gives opportunity_not_owned a pipeline recovery rather than an approval action', async () => {
    const user = userEvent.setup();
    render(<ResumeStudioClient dependencies={dependencies({
      tailor: () => Promise.reject(new ApiError({
        code: 'capability_denied', status: 403,
        message: 'You can only tailor against an opportunity saved in your pipeline.',
        details: { opportunityId: RESUME_OPPORTUNITY_ID, reason: 'opportunity_not_owned' },
      })),
    })} />);
    await user.click(await screen.findByRole('button', { name: 'Tailor résumé draft' }));
    const recovery = await screen.findByTestId('resume-not-owned-recovery');
    expect(recovery).toHaveTextContent('That opportunity is not in your pipeline');
    expect(within(recovery).getByRole('link', { name: 'Review pipeline' })).toHaveAttribute('href', '/opportunities/pipeline');
    expect(screen.queryByRole('button', { name: 'Review and approve' })).not.toBeInTheDocument();
  });

  it.each([
    ['not_found', 404, 'Resume variant not found.'],
    ['validation_failed', 422, 'Expected an opportunityId only.'],
  ] as const)('provides retry and pipeline recovery for %s', async (code, status, message) => {
    const user = userEvent.setup();
    render(<ResumeStudioClient dependencies={dependencies({
      tailor: () => Promise.reject(new ApiError({ code, status, message })),
    })} />);
    await user.click(await screen.findByRole('button', { name: 'Tailor résumé draft' }));
    expect(await screen.findByTestId('error-recovery')).toHaveAttribute('data-code', code);
    expect(screen.getByRole('button', { name: 'Reload résumé studio' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Choose from pipeline' })).toHaveAttribute('href', '/opportunities/pipeline');
  });
});

describe('<AtsCheckPanel>', () => {
  it('renders parse-safety warnings without promising ATS success', () => {
    render(<AtsCheckPanel check={{ passed: false, warnings: ['Avoid text inside graphics.'] }} />);
    expect(screen.getByRole('heading', { name: 'ATS parse-safety check' })).toBeVisible();
    expect(screen.getByRole('list', { name: 'ATS parse-safety warnings' })).toHaveTextContent('Avoid text inside graphics.');
    expect(screen.getByText(/does not promise ranking or selection/i)).toBeVisible();
  });
});