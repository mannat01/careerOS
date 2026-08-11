'use client';

import { useState, type ChangeEvent } from 'react';
import type {
  AutonomyTier,
  OnboardingCompletionResponse,
  UpdateUserSettingsRequest,
  UserSettings,
} from '@careeros/contracts';
import { apiClient, ApiError, createApi } from '@/api';
import { ErrorRecoveryRenderer } from '@/shell/state';
import { TierBadge } from '@/trust';

export interface AutonomyReviewDependencies {
  readonly updateSettings: (body: UpdateUserSettingsRequest) => Promise<UserSettings>;
  readonly completeOnboarding: () => Promise<OnboardingCompletionResponse>;
  readonly goToToday: () => void;
}

const ACTIONS: ReadonlyArray<{
  readonly action: string;
  readonly title: string;
  readonly description: string;
}> = [
  {
    action: 'research.run',
    title: 'Research and organize career information',
    description: 'CareerOS can research sanctioned sources and prepare private, advisory work for you.',
  },
  {
    action: 'draft.send',
    title: 'Send a message or outreach draft',
    description: 'CareerOS can draft, but sending requires your explicit approval for that exact message.',
  },
  {
    action: 'application.submit_assist',
    title: 'Submit an application',
    description: 'CareerOS can prepare materials, but it will not submit without your explicit approval.',
  },
  {
    action: 'offer.accept',
    title: 'Accept an offer',
    description: 'CareerOS can help you reason about an offer, but accepting is always your decision.',
  },
];

const DISPLAY: Readonly<Record<AutonomyTier, { label: string; explanation: string }>> = {
  green: { label: 'Auto', explanation: 'Advisory work can happen automatically.' },
  yellow: { label: 'Needs your OK', explanation: 'CareerOS must ask before the consequential action.' },
  red: { label: 'Never automatic', explanation: 'CareerOS has no automated path for this action.' },
};

function asApiError(cause: unknown, fallback: string): ApiError {
  return cause instanceof ApiError
    ? cause
    : new ApiError({
        code: 'internal',
        message: cause instanceof Error ? cause.message : fallback,
      });
}

export function AutonomyReview({
  initialSettings,
  dependencies,
}: {
  readonly initialSettings: UserSettings;
  readonly dependencies?: AutonomyReviewDependencies;
}): JSX.Element {
  return dependencies
    ? <AutonomyReviewView initialSettings={initialSettings} dependencies={dependencies} />
    : <ProductionAutonomyReview initialSettings={initialSettings} />;
}

function ProductionAutonomyReview({
  initialSettings,
}: {
  readonly initialSettings: UserSettings;
}): JSX.Element {
  const [dependencies] = useState<AutonomyReviewDependencies>(() => {
    const api = createApi(apiClient());
    return {
      updateSettings: (body) => api.me.updateSettings(body),
      completeOnboarding: () => api.me.completeOnboarding(),
      // A full navigation intentionally bypasses any `/today` redirect that
      // Next prefetched while onboarding was still required. The Step-0 server
      // guard then reads the freshly completed backend state before rendering.
      goToToday: () => window.location.assign('/today'),
    };
  });
  return <AutonomyReviewView initialSettings={initialSettings} dependencies={dependencies} />;
}

function AutonomyReviewView({
  initialSettings,
  dependencies: deps,
}: {
  readonly initialSettings: UserSettings;
  readonly dependencies: AutonomyReviewDependencies;
}): JSX.Element {
  const [settings, setSettings] = useState(initialSettings);
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [failure, setFailure] = useState<{
    readonly error: ApiError;
    readonly retry: () => void;
  } | null>(null);

  async function saveTier(action: string, tier: AutonomyTier): Promise<void> {
    setSavingAction(action);
    setFailure(null);
    try {
      const updated = await deps.updateSettings({ autonomyDefaults: { [action]: tier } });
      setSettings(updated);
    } catch (cause) {
      setFailure({
        error: asApiError(cause, 'Autonomy settings could not be saved.'),
        retry: () => void saveTier(action, tier),
      });
    } finally {
      setSavingAction(null);
    }
  }

  function updateTier(event: ChangeEvent<HTMLSelectElement>, action: string): void {
    void saveTier(action, event.target.value as AutonomyTier);
  }

  async function complete(): Promise<void> {
    setCompleting(true);
    setFailure(null);
    try {
      const result = await deps.completeOnboarding();
      if (result.onboarding.status !== 'complete') {
        throw new Error('The completion response did not mark onboarding complete.');
      }
      deps.goToToday();
    } catch (cause) {
      setFailure({
        error: asApiError(cause, 'Onboarding could not be completed.'),
        retry: () => void complete(),
      });
      setCompleting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-base">
          Onboarding · autonomy review
        </p>
        <h1 className="text-3xl font-semibold text-text-primary">
          How CareerOS will and won't act for you
        </h1>
        <p className="max-w-3xl text-text-secondary">
          The defaults are conservative. CareerOS can research, organize, and draft; consequential
          actions need your OK, and some decisions are never automatic.
        </p>
      </header>

      <div className="grid gap-4" data-testid="autonomy-actions">
        {ACTIONS.map(({ action, title, description }) => {
          const tier = settings.autonomyDefaults[action] ?? 'red';
          const editable = tier !== 'red';
          return (
            <section
              key={action}
              aria-labelledby={`autonomy-${action}`}
              className="rounded-lg border border-border-subtle bg-bg-elevated p-4"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="mr-auto max-w-2xl">
                  <h2 id={`autonomy-${action}`} className="font-semibold text-text-primary">{title}</h2>
                  <p className="mt-1 text-sm text-text-secondary">{description}</p>
                  <p className="mt-2 text-xs text-text-muted">{DISPLAY[tier].explanation}</p>
                </div>
                <TierBadge tier={tier} label={DISPLAY[tier].label} size="md" />
              </div>
              {editable ? (
                <div className="mt-4 max-w-xs">
                  <label htmlFor={`tier-${action}`} className="text-sm font-medium text-text-primary">
                    Make this more restrictive
                  </label>
                  <select
                    id={`tier-${action}`}
                    value={tier}
                    onChange={(event) => updateTier(event, action)}
                    disabled={savingAction !== null || completing}
                    className="mt-1 w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-60"
                  >
                    {tier === 'green' ? <option value="green">Auto</option> : null}
                    <option value="yellow">Needs your OK</option>
                    <option value="red">Never automatic</option>
                  </select>
                  {savingAction === action ? <p className="mt-1 text-xs text-text-muted">Saving…</p> : null}
                </div>
              ) : (
                <p className="mt-4 text-sm font-medium text-tier-red">This boundary cannot be loosened.</p>
              )}
            </section>
          );
        })}
      </div>

      {failure ? (
        <ErrorRecoveryRenderer error={failure.error} onRetry={failure.retry} />
      ) : null}

      <div className="rounded-lg border border-brand-base bg-bg-subtle p-5">
        <p className="text-sm text-text-secondary">
          You can tighten these controls now and review them again later in Settings.
        </p>
        <button
          type="button"
          onClick={() => void complete()}
          disabled={completing || savingAction !== null}
          className="mt-4 rounded-md bg-brand-base px-5 py-2.5 text-sm font-medium text-text-inverse outline-none focus-visible:ring-2 focus-visible:ring-brand-base disabled:cursor-wait disabled:opacity-60"
        >
          {completing ? 'Starting CareerOS…' : 'This looks right — start using CareerOS'}
        </button>
      </div>
    </main>
  );
}