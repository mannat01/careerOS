import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultUserSettings,
  onboardingCompletionResponseSchema,
} from '@careeros/contracts';
import { ApiError } from '@/api';
import { AutonomyReview, type AutonomyReviewDependencies } from './AutonomyReview';

const USER = '00000000-0000-4000-8000-000000000001';
const NOW = '2026-08-11T12:00:00.000Z';
const SETTINGS = defaultUserSettings(USER, NOW);
const COMPLETE = onboardingCompletionResponseSchema.parse({
  user: {
    id: USER,
    email: 'dev@careeros.local',
    authProviderId: `dev|${USER}`,
    subscriptionTier: 'free',
    status: 'active',
    onboardingCompletedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  },
  settings: SETTINGS,
  onboarding: { status: 'complete', completedAt: NOW },
});

afterEach(cleanup);

function dependencies(overrides: Partial<AutonomyReviewDependencies> = {}): AutonomyReviewDependencies {
  return {
    updateSettings: (body) => Promise.resolve({
      ...SETTINGS,
      autonomyDefaults: { ...SETTINGS.autonomyDefaults, ...body.autonomyDefaults },
    }),
    completeOnboarding: () => Promise.resolve(COMPLETE),
    goToToday: vi.fn(),
    ...overrides,
  };
}

describe('FM2.3 autonomy review', () => {
  it('renders conservative plain-language defaults with TierBadge semantics', () => {
    render(<AutonomyReview initialSettings={SETTINGS} dependencies={dependencies()} />);
    expect(screen.getByRole('heading', { name: "How CareerOS will and won't act for you" }))
      .toBeInTheDocument();
    const actions = screen.getByTestId('autonomy-actions');
    expect(within(actions).getAllByTestId('tier-label').map((label) => label.textContent))
      .toEqual(['Auto', 'Needs your OK', 'Needs your OK', 'Never automatic']);
    expect(screen.getAllByTestId('tier-badge')).toHaveLength(4);
    expect(screen.getByText('This boundary cannot be loosened.')).toBeInTheDocument();
  });

  it('allows a Green default to be tightened through PATCH settings and rerenders it', async () => {
    const updateSettings = vi.fn<AutonomyReviewDependencies['updateSettings']>((body) =>
      Promise.resolve({
        ...SETTINGS,
        autonomyDefaults: { ...SETTINGS.autonomyDefaults, ...body.autonomyDefaults },
      }),
    );
    const user = userEvent.setup();
    render(
      <AutonomyReview
        initialSettings={SETTINGS}
        dependencies={dependencies({ updateSettings })}
      />,
    );
    const select = screen.getByLabelText('Make this more restrictive', {
      selector: '#tier-research\\.run',
    });
    await user.selectOptions(select, 'yellow');
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({
      autonomyDefaults: { 'research.run': 'yellow' },
    }));
    expect(select).toHaveValue('yellow');
  });

  it('completes onboarding before routing to Today', async () => {
    const completeOnboarding = vi.fn<AutonomyReviewDependencies['completeOnboarding']>()
      .mockResolvedValue(COMPLETE);
    const goToToday = vi.fn();
    const user = userEvent.setup();
    render(
      <AutonomyReview
        initialSettings={SETTINGS}
        dependencies={dependencies({ completeOnboarding, goToToday })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'This looks right — start using CareerOS' }));
    await waitFor(() => expect(goToToday).toHaveBeenCalledOnce());
    expect(completeOnboarding).toHaveBeenCalledOnce();
    expect(completeOnboarding.mock.invocationCallOrder[0])
      .toBeLessThan(goToToday.mock.invocationCallOrder[0]!);
  });

  it('renders dependency recovery and does not redirect on completion failure', async () => {
    const goToToday = vi.fn();
    const user = userEvent.setup();
    render(
      <AutonomyReview
        initialSettings={SETTINGS}
        dependencies={dependencies({
          completeOnboarding: () => Promise.reject(new ApiError({
            code: 'internal', message: 'Completion unavailable.', traceId: 'fm23-trace',
          })),
          goToToday,
        })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'This looks right — start using CareerOS' }));
    expect(await screen.findByTestId('error-recovery')).toBeVisible();
    expect(goToToday).not.toHaveBeenCalled();
  });
});