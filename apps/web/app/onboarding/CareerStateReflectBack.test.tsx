import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  profileFactEditResponseSchema,
  type CieDimensionKey,
} from '@careeros/contracts';
import { ApiError } from '@/api';
import { POPULATED_IMPORT } from './onboarding-fixtures';
import {
  CareerStateReflectBack,
  CareerStateReview,
  type CareerStateDependencies,
} from './CareerStateReflectBack';
import {
  CORRECTED_EXPLANATIONS,
  CORRECTED_STATE,
  NO_SIGNAL_STATE,
  POPULATED_STATE,
  STATE_EXPLANATIONS,
} from './state-fixtures';

afterEach(cleanup);

function explanation(dimension: CieDimensionKey) {
  const result = STATE_EXPLANATIONS[dimension];
  if (!result) throw new Error(`Missing explanation fixture: ${dimension}`);
  return Promise.resolve(result);
}

describe('FM2.2 reflect-back state model', () => {
  it('renders API values, confidence, provenance, explanations, and skill distinction', async () => {
    const user = userEvent.setup();
    render(
      <CareerStateReview
        model={POPULATED_STATE}
        explanations={STATE_EXPLANATIONS}
      />,
    );

    expect(screen.getByRole('heading', { name: 'What CareerOS understands about you' }))
      .toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText('Systems thinking')).toBeInTheDocument();
    expect(screen.getByText('Demonstrated in your evidence')).toBeInTheDocument();
    expect(screen.getByText('Inferred by AI — review carefully')).toBeInTheDocument();
    expect(screen.getByText('Demonstrated')).toBeInTheDocument();
    expect(screen.getByText('Inferred by AI')).toBeInTheDocument();
    expect(screen.getAllByTestId('ai-surface')).toHaveLength(2);
    expect(screen.getAllByTestId('confidence-chip')).toHaveLength(3);

    const why = screen.getAllByTestId('why-trigger')[0]!;
    await user.click(why);
    expect(screen.getByText('TypeScript is grounded in a profile skill fact.'))
      .toBeInTheDocument();
    expect(screen.getByText('TypeScript (intermediate)')).toBeInTheDocument();
  });

  it('uses InsufficientData for no-signal without a fabricated value or AiSurface', () => {
    render(
      <CareerStateReview
        model={NO_SIGNAL_STATE}
        explanations={STATE_EXPLANATIONS}
      />,
    );

    expect(screen.getByTestId('insufficient-data')).toBeVisible();
    expect(screen.getByText('Not enough signal yet')).toBeInTheDocument();
    expect(screen.getByText('How to build it')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-surface')).not.toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });

  it('performs one initial recompute when GET state is not found, then renders GET truth', async () => {
    const getState = vi
      .fn<CareerStateDependencies['getState']>()
      .mockRejectedValueOnce(new ApiError({ code: 'not_found', message: 'No state.' }))
      .mockResolvedValueOnce(NO_SIGNAL_STATE);
    const recompute = vi.fn<CareerStateDependencies['recompute']>()
      .mockResolvedValue(NO_SIGNAL_STATE);
    render(
      <CareerStateReflectBack
        dependencies={{
          getState,
          explain: explanation,
          editFact: vi.fn(),
          recompute,
        }}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'What CareerOS understands about you' }))
      .toBeInTheDocument();
    expect(getState).toHaveBeenCalledTimes(2);
    expect(recompute).toHaveBeenCalledWith();
  });

  it('PATCHes the evidence fact, then recomputes and visibly flips corrected provenance to user', async () => {
    const editFact = vi.fn<CareerStateDependencies['editFact']>().mockResolvedValue(
      profileFactEditResponseSchema.parse({
        fact: {
          id: '00000000-0000-4000-8000-000000000102',
          kind: 'skill',
          label: 'PostgreSQL',
          detail: 'intermediate',
          provenance: 'user',
        },
      }),
    );
    const recompute = vi.fn<CareerStateDependencies['recompute']>()
      .mockResolvedValue(CORRECTED_STATE);
    let corrected = false;
    const explain = vi.fn<CareerStateDependencies['explain']>((dimension) => {
      const source = corrected ? CORRECTED_EXPLANATIONS : STATE_EXPLANATIONS;
      const result = source[dimension];
      if (!result) return Promise.reject(new Error(`Missing explanation: ${dimension}`));
      return Promise.resolve(result);
    });
    recompute.mockImplementation((change) => {
      corrected = true;
      expect(change).toEqual({
        factId: 'skill:00000000-0000-4000-8000-000000000102',
        reason: 'User corrected demonstrated_skills',
      });
      return Promise.resolve(CORRECTED_STATE);
    });
    const user = userEvent.setup();
    render(
      <CareerStateReflectBack
        dependencies={{
          getState: () => Promise.resolve(POPULATED_STATE),
          explain,
          editFact,
          recompute,
        }}
      />,
    );

    await screen.findByText('TypeScript');
    await user.click(screen.getByRole('button', { name: 'Correct source fact: TypeScript (intermediate)' }));
    const input = screen.getByRole('textbox', { name: 'Corrected skill fact' });
    await user.clear(input);
    await user.type(input, 'PostgreSQL');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    expect(await screen.findByTestId('authoritative-corrections')).toBeVisible();
    expect(editFact).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000102',
      { kind: 'skill', label: 'PostgreSQL' },
    );
    expect(editFact.mock.invocationCallOrder[0]).toBeLessThan(recompute.mock.invocationCallOrder[0]!);
    const correctionRegion = screen.getByTestId('authoritative-corrections');
    expect(within(correctionRegion).getByText('PostgreSQL')).toBeInTheDocument();
    expect(within(correctionRegion).getByText('You added')).toBeInTheDocument();
    expect(screen.getAllByText('PostgreSQL').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('You added').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps fake-model no-signal honest while an imported fact correction becomes user-authored', async () => {
    const editFact = vi.fn<CareerStateDependencies['editFact']>().mockResolvedValue(
      profileFactEditResponseSchema.parse({
        fact: {
          id: '00000000-0000-4000-8000-000000000102',
          kind: 'skill',
          label: 'PostgreSQL',
          detail: null,
          provenance: 'user',
        },
      }),
    );
    const recompute = vi.fn<CareerStateDependencies['recompute']>()
      .mockResolvedValue(NO_SIGNAL_STATE);
    const user = userEvent.setup();
    render(
      <CareerStateReflectBack
        importedFacts={POPULATED_IMPORT.entities}
        dependencies={{
          getState: () => Promise.resolve(NO_SIGNAL_STATE),
          explain: explanation,
          editFact,
          recompute,
        }}
      />,
    );

    expect(await screen.findByText('Not enough signal yet')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Correct source fact: TypeScript' }));
    const input = screen.getByRole('textbox', { name: 'Corrected skill fact' });
    await user.clear(input);
    await user.type(input, 'PostgreSQL');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    expect(await screen.findByTestId('authoritative-corrections')).toBeVisible();
    expect(editFact).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000102',
      { kind: 'skill', label: 'PostgreSQL' },
    );
    expect(recompute).toHaveBeenCalledWith({
      factId: 'skill:00000000-0000-4000-8000-000000000102',
      reason: 'User corrected skill profile fact',
    });
    expect(screen.getByText('Not enough signal yet')).toBeVisible();
    expect(screen.queryByTestId('ai-surface')).not.toBeInTheDocument();
    const sourceFacts = screen.getByRole('region', { name: 'Profile facts behind this model' });
    expect(within(sourceFacts).getAllByText('PostgreSQL')).toHaveLength(2);
    expect(within(sourceFacts).getByText('You added')).toBeInTheDocument();
  });
});