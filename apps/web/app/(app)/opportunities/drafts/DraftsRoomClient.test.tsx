import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  draftResponseSchema,
  type DraftGenerateRequest,
} from '@careeros/contracts';
import { ApiError } from '@/api';
import { DraftsRoomClient, type DraftsRoomDependencies } from './DraftsRoomClient';
import {
  DRAFT_OPPORTUNITY,
  DRAFT_OPPORTUNITY_ID,
  DRAFT_PIPELINE,
  GROUNDED_DRAFT,
  THIN_DRAFT,
} from './draft-fixtures';

afterEach(cleanup);

function dependencies(overrides: Partial<DraftsRoomDependencies> = {}): DraftsRoomDependencies {
  return {
    listApplications: () => Promise.resolve(DRAFT_PIPELINE),
    getOpportunity: () => Promise.resolve(DRAFT_OPPORTUNITY),
    generate: () => Promise.resolve(GROUNDED_DRAFT),
    copyText: () => Promise.resolve(),
    ...overrides,
  };
}

describe('FM6.3 Drafts room', () => {
  it('offers only opportunities from GET /v1/applications, never the global browse list', async () => {
    const listApplications = vi.fn(() => Promise.resolve(DRAFT_PIPELINE));
    const getOpportunity = vi.fn(() => Promise.resolve(DRAFT_OPPORTUNITY));
    render(<DraftsRoomClient dependencies={dependencies({ listApplications, getOpportunity })} />);

    expect(await screen.findByRole('option', { name: 'Staff Engineer · Nimbus' })).toHaveValue(DRAFT_OPPORTUNITY_ID);
    expect(listApplications).toHaveBeenCalledOnce();
    expect(getOpportunity).toHaveBeenCalledOnce();
    expect(getOpportunity).toHaveBeenCalledWith(DRAFT_PIPELINE.data[0]!.opportunityId);
    expect(screen.getByText(/choose only from opportunities stored in your pipeline/i)).toBeVisible();
  });

  it('completes the cover-letter flow and renders subject, body, opportunity provenance, claims, and factRef evidence', async () => {
    const generate = vi.fn((_request: DraftGenerateRequest) => Promise.resolve(GROUNDED_DRAFT));
    const user = userEvent.setup();
    render(<DraftsRoomClient dependencies={dependencies({ generate })} />);

    await user.click(await screen.findByRole('button', { name: 'Generate draft' }));

    expect(generate).toHaveBeenCalledWith({ kind: 'cover_letter', opportunityId: DRAFT_OPPORTUNITY_ID });
    const result = await screen.findByTestId('grounded-draft');
    expect(within(result).getByText(GROUNDED_DRAFT.status === 'draft' ? GROUNDED_DRAFT.subject : '')).toBeVisible();
    expect(within(result).getAllByText(/built reliable TypeScript services/i)).toHaveLength(2);
    expect(within(result).getByText(`Opportunity provenance: Staff Engineer at Nimbus · stored opportunity ${DRAFT_OPPORTUNITY_ID}`)).toBeVisible();
    expect(within(result).getByRole('heading', { name: 'Claims and grounding' })).toBeVisible();
    expect(within(result).getByText('Evidence provenance: experience:typescript')).toBeVisible();
    expect(within(result).getByText('Generation provenance: post-guardrail model drafter@fake-grounded')).toBeVisible();
    expect(within(result).getByText('This is a draft. Nothing was sent or submitted.')).toBeVisible();
    expect(screen.queryByTestId('ai-surface')).not.toBeInTheDocument();
    expect(screen.queryByTestId('confidence-chip')).not.toBeInTheDocument();
  });

  it('sends optional recipient fields only for outreach and preserves the shared request shape', async () => {
    const outreach = draftResponseSchema.parse({
      ...(GROUNDED_DRAFT.status === 'draft' ? GROUNDED_DRAFT : {}),
      kind: 'outreach',
      recipient: { name: 'Dana', role: 'Hiring manager', channel: 'email' },
      subject: 'Interested in the Staff Engineer opening',
    });
    const generate = vi.fn((_request: DraftGenerateRequest) => Promise.resolve(outreach));
    const user = userEvent.setup();
    render(<DraftsRoomClient dependencies={dependencies({ generate })} />);

    await user.selectOptions(await screen.findByLabelText('Draft kind'), 'outreach');
    await user.type(screen.getByLabelText('Name'), ' Dana ');
    await user.type(screen.getByLabelText('Role'), ' Hiring manager ');
    await user.type(screen.getByLabelText('Channel'), ' email ');
    await user.click(screen.getByRole('button', { name: 'Generate draft' }));

    expect(generate).toHaveBeenCalledWith({
      kind: 'outreach',
      opportunityId: DRAFT_OPPORTUNITY_ID,
      recipient: { name: 'Dana', role: 'Hiring manager', channel: 'email' },
    });
    expect(await screen.findByText('Interested in the Staff Engineer opening')).toBeVisible();
  });

  it('omits an empty optional outreach recipient instead of sending an empty object', async () => {
    const outreach = draftResponseSchema.parse({
      ...(GROUNDED_DRAFT.status === 'draft' ? GROUNDED_DRAFT : {}),
      kind: 'outreach', recipient: null, subject: 'Interested in the Staff Engineer opening',
    });
    const generate = vi.fn((_request: DraftGenerateRequest) => Promise.resolve(outreach));
    const user = userEvent.setup();
    render(<DraftsRoomClient dependencies={dependencies({ generate })} />);

    await user.selectOptions(await screen.findByLabelText('Draft kind'), 'outreach');
    await user.click(screen.getByRole('button', { name: 'Generate draft' }));
    expect(generate).toHaveBeenCalledWith({ kind: 'outreach', opportunityId: DRAFT_OPPORTUNITY_ID });
  });

  it('renders insufficient_data as InsufficientData without fabricating subject, body, or claims', async () => {
    const user = userEvent.setup();
    render(<DraftsRoomClient dependencies={dependencies({ generate: () => Promise.resolve(THIN_DRAFT) })} />);
    await user.click(await screen.findByRole('button', { name: 'Generate draft' }));

    expect(await screen.findByRole('heading', { name: 'Not enough grounded evidence for a draft' })).toBeVisible();
    expect(screen.getByText(/returned no subject or message text/i)).toBeVisible();
    expect(screen.queryByTestId('grounded-draft')).not.toBeInTheDocument();
    expect(screen.queryByText('Application for Staff Engineer at Nimbus')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy draft to clipboard' })).not.toBeInTheDocument();
  });

  it('copies subject and body as the only export and has no send, submit, Yellow, Red, or approval control', async () => {
    const copyText = vi.fn((_text: string) => Promise.resolve());
    const user = userEvent.setup();
    render(<DraftsRoomClient dependencies={dependencies({ copyText })} />);
    await user.click(await screen.findByRole('button', { name: 'Generate draft' }));
    await user.click(await screen.findByRole('button', { name: 'Copy draft to clipboard' }));

    if (GROUNDED_DRAFT.status !== 'draft') throw new Error('Expected grounded fixture.');
    expect(copyText).toHaveBeenCalledWith(`${GROUNDED_DRAFT.subject}\n\n${GROUNDED_DRAFT.body}`);
    expect(await screen.findByText('Draft copied. Nothing was sent or submitted.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /send|submit|approve|review and approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('[data-tier="yellow"], [data-tier="red"]')).toBeNull();
  });

  it('renders an honest empty picker when the caller pipeline has no applications', async () => {
    const getOpportunity = vi.fn(() => Promise.resolve(DRAFT_OPPORTUNITY));
    render(<DraftsRoomClient dependencies={dependencies({
      listApplications: () => Promise.resolve({ data: [] }),
      getOpportunity,
    })} />);
    expect(await screen.findByRole('heading', { name: 'No pipeline opportunity to draft for' })).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Pipeline opportunity' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open your pipeline' })).toHaveAttribute('href', '/opportunities/pipeline');
    expect(getOpportunity).not.toHaveBeenCalled();
  });

  it('gives opportunity_not_owned a pipeline recovery rather than an approval action', async () => {
    const user = userEvent.setup();
    render(<DraftsRoomClient dependencies={dependencies({
      generate: () => Promise.reject(new ApiError({
        code: 'capability_denied', status: 403,
        message: 'You can only generate a draft for an opportunity saved in your pipeline.',
        details: { opportunityId: DRAFT_OPPORTUNITY_ID, reason: 'opportunity_not_owned' },
      })),
    })} />);
    await user.click(await screen.findByRole('button', { name: 'Generate draft' }));
    const recovery = await screen.findByTestId('draft-not-owned-recovery');
    expect(recovery).toHaveTextContent('That opportunity is not in your pipeline');
    expect(within(recovery).getByRole('link', { name: 'Review pipeline' })).toHaveAttribute('href', '/opportunities/pipeline');
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it.each([
    ['not_found', 404, 'Opportunity not found.'],
    ['validation_failed', 422, 'Invalid draft generation payload.'],
  ] as const)('provides retry, reload, and pipeline recovery for %s', async (code, status, message) => {
    const user = userEvent.setup();
    render(<DraftsRoomClient dependencies={dependencies({
      generate: () => Promise.reject(new ApiError({ code, status, message })),
    })} />);
    await user.click(await screen.findByRole('button', { name: 'Generate draft' }));
    expect(await screen.findByTestId('error-recovery')).toHaveAttribute('data-code', code);
    expect(screen.getByRole('button', { name: 'Reload pipeline opportunities' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Choose from pipeline' })).toHaveAttribute('href', '/opportunities/pipeline');
  });
});