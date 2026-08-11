import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProfileImportResponse } from '@careeros/contracts';
import { ExtractionReview, OnboardingImportClient } from './OnboardingImportClient';
import { POPULATED_IMPORT, THIN_IMPORT } from './onboarding-fixtures';

afterEach(cleanup);

describe('FM2.1 résumé import flow', () => {
  it('submits pasted text through the typed-client seam and transitions to review', async () => {
    const importResume = vi.fn(() => Promise.resolve(POPULATED_IMPORT));
    const user = userEvent.setup();
    render(<OnboardingImportClient importResume={importResume} />);

    const submit = screen.getByRole('button', { name: 'Extract résumé' });
    expect(submit).toBeDisabled();

    await user.type(
      screen.getByRole('textbox', { name: 'Résumé text' }),
      'Senior Engineer at Acme',
    );
    await user.click(submit);

    expect(importResume).toHaveBeenCalledOnce();
    expect(importResume).toHaveBeenCalledWith('Senior Engineer at Acme');
    expect(await screen.findByRole('heading', { name: 'Review your extracted résumé' }))
      .toBeInTheDocument();
    expect(screen.getByText('Senior Engineer at Acme')).toBeInTheDocument();
  });

  it('renders a visible typed error recovery and can retry the same résumé text', async () => {
    const importResume = vi
      .fn<() => Promise<ProfileImportResponse>>()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(POPULATED_IMPORT);
    const user = userEvent.setup();
    render(<OnboardingImportClient importResume={importResume} />);

    await user.type(screen.getByRole('textbox', { name: 'Résumé text' }), 'Acme résumé');
    await user.click(screen.getByRole('button', { name: 'Extract résumé' }));

    expect(await screen.findByTestId('error-recovery')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Review your extracted résumé' }))
      .toBeInTheDocument();
    expect(importResume).toHaveBeenCalledTimes(2);
  });
});

describe('FM2.1 extraction review', () => {
  it('renders only returned entities in all four groups with verbatim source quotes', () => {
    render(<ExtractionReview result={POPULATED_IMPORT} />);

    for (const heading of ['Experience', 'Skills', 'Education', 'Projects']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    for (const entity of POPULATED_IMPORT.entities) {
      expect(screen.getByText(entity.name)).toBeInTheDocument();
      expect(screen.getByText(entity.provenance.quote)).toBeInTheDocument();
    }
    expect(screen.getAllByTestId('provenance-tag')).toHaveLength(4);
    expect(screen.getAllByTestId('provenance-quote')).toHaveLength(4);
    expect(screen.getByText(/we used only what's in your résumé/i)).toBeInTheDocument();

    // The contract has no extraction confidence. The UI must not fabricate one.
    expect(screen.queryByTestId('ai-surface')).not.toBeInTheDocument();
    expect(screen.queryByTestId('confidence-chip')).not.toBeInTheDocument();
    expect(screen.queryByText(/leadership|expert|recommended/i)).not.toBeInTheDocument();
  });

  it('renders InsufficientData instead of fabricated entities for a thin response', () => {
    render(<ExtractionReview result={THIN_IMPORT} />);

    expect(screen.getByTestId('insufficient-data')).toBeVisible();
    expect(screen.getByText('Not enough résumé detail yet')).toBeInTheDocument();
    expect(screen.queryByTestId('extraction-groups')).not.toBeInTheDocument();
    expect(screen.queryByTestId('provenance-tag')).not.toBeInTheDocument();
  });

  it('returns to the pasted résumé without issuing a completion write', async () => {
    const importResume = vi.fn(() => Promise.resolve(POPULATED_IMPORT));
    const user = userEvent.setup();
    render(<OnboardingImportClient importResume={importResume} />);

    await user.type(screen.getByRole('textbox', { name: 'Résumé text' }), 'Exact résumé text');
    await user.click(screen.getByRole('button', { name: 'Extract résumé' }));
    await user.click(await screen.findByRole('button', { name: 'Back to résumé text' }));

    expect(screen.getByRole('textbox', { name: 'Résumé text' })).toHaveValue('Exact résumé text');
    await waitFor(() => expect(importResume).toHaveBeenCalledOnce());
  });
});
