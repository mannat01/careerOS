import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  interviewPrepResponseSchema,
  type InterviewPrepRequest,
} from '@careeros/contracts';
import { ApiError } from '@/api';
import { InterviewPrepRoomClient, type InterviewPrepRoomDependencies } from './InterviewPrepRoomClient';
import {
  GROUNDED_INTERVIEW_PREP,
  INTERVIEW_OPPORTUNITY,
  INTERVIEW_OPPORTUNITY_ID,
  INTERVIEW_PIPELINE,
  THIN_INTERVIEW_PREP,
} from './interview-prep-fixtures';

afterEach(cleanup);

function dependencies(overrides: Partial<InterviewPrepRoomDependencies> = {}): InterviewPrepRoomDependencies {
  return {
    listApplications: () => Promise.resolve(INTERVIEW_PIPELINE),
    getOpportunity: () => Promise.resolve(INTERVIEW_OPPORTUNITY),
    prepare: () => Promise.resolve(GROUNDED_INTERVIEW_PREP),
    ...overrides,
  };
}

describe('FM6.1 interview prep room', () => {
  it('offers only opportunities from the caller pipeline, never the global browse list', async () => {
    const getOpportunity = vi.fn(() => Promise.resolve(INTERVIEW_OPPORTUNITY));
    render(<InterviewPrepRoomClient dependencies={dependencies({ getOpportunity })} />);

    expect(await screen.findByRole('option', { name: 'Staff Backend Engineer · Helios Labs' })).toHaveValue(INTERVIEW_OPPORTUNITY_ID);
    expect(getOpportunity).toHaveBeenCalledOnce();
    expect(getOpportunity).toHaveBeenCalledWith(INTERVIEW_PIPELINE.data[0]!.opportunityId);
    expect(screen.getByText(/choose only from opportunities stored in your pipeline/i)).toBeVisible();
  });

  it('completes the full generate flow and renders JD grounding, profile evidence, and generation provenance', async () => {
    const prepare = vi.fn((_request: InterviewPrepRequest) => Promise.resolve(GROUNDED_INTERVIEW_PREP));
    const user = userEvent.setup();
    render(<InterviewPrepRoomClient dependencies={dependencies({ prepare })} />);

    await user.click(await screen.findByRole('button', { name: 'Generate practice questions' }));

    expect(prepare).toHaveBeenCalledWith({ opportunityId: INTERVIEW_OPPORTUNITY_ID });
    const material = await screen.findByTestId('grounded-interview-prep');
    expect(within(material).getByText('Tell me about your experience with TypeScript services.')).toBeVisible();
    expect(within(material).getByRole('heading', { name: 'Grounded in this real JD requirement' })).toBeVisible();
    expect(within(material).getByText('TypeScript services')).toBeVisible();
    expect(within(material).getByText('Use your real experience building reliable TypeScript services.')).toBeVisible();
    expect(within(material).getByText('Profile fact provenance: experience:typescript')).toBeVisible();
    expect(within(material).getByText(`Generation provenance: post-guardrail model ${GROUNDED_INTERVIEW_PREP.modelVersion}`)).toBeVisible();
    expect(within(material).getByText('This is practice. Nothing was sent or submitted.')).toBeVisible();
    expect(screen.queryByTestId('ai-surface')).not.toBeInTheDocument();
    expect(screen.queryByTestId('confidence-chip')).not.toBeInTheDocument();
    expect(screen.queryByText(/approve/i)).not.toBeInTheDocument();
  });

  it('renders the fake/thin response as InsufficientData without inventing a question or answer', async () => {
    const user = userEvent.setup();
    render(<InterviewPrepRoomClient dependencies={dependencies({ prepare: () => Promise.resolve(THIN_INTERVIEW_PREP) })} />);
    await user.click(await screen.findByRole('button', { name: 'Generate practice questions' }));

    expect(await screen.findByRole('heading', { name: 'Not enough grounded interview material' })).toBeVisible();
    expect(screen.getByText(/did not invent a question or answer/i)).toBeVisible();
    expect(screen.queryByTestId('grounded-interview-prep')).not.toBeInTheDocument();
  });

  it('uses InsufficientData for a real-JD question with no profile-backed answer evidence', async () => {
    const noAnswerGrounding = interviewPrepResponseSchema.parse({
      status: 'ready', opportunityId: INTERVIEW_OPPORTUNITY_ID, modelVersion: 'interviewer@fake-grounded',
      questions: [{
        id: 'iq-gap', kind: 'technical', prompt: 'Tell me about Kubernetes.',
        grounding: { opportunityId: INTERVIEW_OPPORTUNITY_ID, requirements: ['Kubernetes'], profileFactRefs: [] },
        suggestedAnswer: {
          framing: 'I have not directly worked on that.', evidence: [],
          honestGap: { strategy: 'address_gap', competency: 'Kubernetes', note: 'Acknowledge the gap.' },
        },
      }],
    });
    const user = userEvent.setup();
    render(<InterviewPrepRoomClient dependencies={dependencies({ prepare: () => Promise.resolve(noAnswerGrounding) })} />);
    await user.click(await screen.findByRole('button', { name: 'Generate practice questions' }));

    expect(await screen.findByRole('heading', { name: 'No profile-grounded answer framing' })).toBeVisible();
    expect(screen.queryByText('I have not directly worked on that.')).not.toBeInTheDocument();
  });

  it('renders an honest empty picker when the caller pipeline has no applications', async () => {
    const getOpportunity = vi.fn(() => Promise.resolve(INTERVIEW_OPPORTUNITY));
    render(<InterviewPrepRoomClient dependencies={dependencies({
      listApplications: () => Promise.resolve({ data: [] }),
      getOpportunity,
    })} />);
    expect(await screen.findByRole('heading', { name: 'No pipeline opportunity to prepare for' })).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Pipeline opportunity' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open your pipeline' })).toHaveAttribute('href', '/opportunities/pipeline');
    expect(getOpportunity).not.toHaveBeenCalled();
  });

  it('gives opportunity_not_owned a pipeline recovery rather than an approval action', async () => {
    const user = userEvent.setup();
    render(<InterviewPrepRoomClient dependencies={dependencies({
      prepare: () => Promise.reject(new ApiError({
        code: 'capability_denied', status: 403,
        message: 'You can only prepare for an opportunity saved in your pipeline.',
        details: { opportunityId: INTERVIEW_OPPORTUNITY_ID, reason: 'opportunity_not_owned' },
      })),
    })} />);
    await user.click(await screen.findByRole('button', { name: 'Generate practice questions' }));
    const recovery = await screen.findByTestId('interview-not-owned-recovery');
    expect(recovery).toHaveTextContent('That opportunity is not in your pipeline');
    expect(within(recovery).getByRole('link', { name: 'Review pipeline' })).toHaveAttribute('href', '/opportunities/pipeline');
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it.each([
    ['not_found', 404, 'Opportunity not found.'],
    ['validation_failed', 422, 'Expected a valid opportunityId.'],
  ] as const)('provides retry, reload, and pipeline recovery for %s', async (code, status, message) => {
    const user = userEvent.setup();
    render(<InterviewPrepRoomClient dependencies={dependencies({
      prepare: () => Promise.reject(new ApiError({ code, status, message })),
    })} />);
    await user.click(await screen.findByRole('button', { name: 'Generate practice questions' }));
    expect(await screen.findByTestId('error-recovery')).toHaveAttribute('data-code', code);
    expect(screen.getByRole('button', { name: 'Reload pipeline opportunities' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Choose from pipeline' })).toHaveAttribute('href', '/opportunities/pipeline');
  });
});