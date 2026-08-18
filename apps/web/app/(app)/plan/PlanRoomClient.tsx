'use client';

import {
  planSetResponseSchema,
  type PlanActionResponse,
  type PlanResponse,
  type PlanSetResponse,
} from '@careeros/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiClient, createApi } from '@/api';
import { ErrorRecoveryRenderer, ListSkeleton } from '@/shell/state';
import { InsufficientData, TierBadge } from '@/trust';

export interface PlanRoomDependencies {
  /** The only network capability available to Plan: read caller-scoped plans. */
  readonly getPlans: () => Promise<PlanSetResponse>;
}

type RoomState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: ApiError }
  | { readonly kind: 'ready'; readonly response: PlanSetResponse };

const HORIZON_LABEL: Readonly<Record<PlanResponse['horizon'], string>> = {
  '30d': '30 days',
  '90d': '90 days',
  '1y': '1 year',
  '3y': '3 years',
  '5y': '5 years',
};

function productionDependencies(): PlanRoomDependencies {
  const plans = createApi(apiClient()).plans;
  return { getPlans: () => plans.get() };
}

function asApiError(cause: unknown): ApiError {
  return cause instanceof ApiError ? cause : new ApiError({
    code: 'internal',
    message: cause instanceof Error ? cause.message : 'Your plan could not be loaded.',
  });
}

function formatBackendDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export function PlanRoomClient({ dependencies }: { readonly dependencies?: PlanRoomDependencies }): JSX.Element {
  const [deps] = useState(() => dependencies ?? productionDependencies());
  const [state, setState] = useState<RoomState>({ kind: 'loading' });

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', response: planSetResponseSchema.parse(await deps.getPlans()) });
    } catch (cause) {
      setState({ kind: 'error', error: asApiError(cause) });
    }
  }, [deps]);

  useEffect(() => { void load(); }, [load]);

  if (state.kind === 'loading') {
    return <ListSkeleton rows={3} label="Loading your grounded plan…" testId="plan-loading" />;
  }
  if (state.kind === 'error') {
    return (
      <div className="space-y-5">
        <section aria-labelledby="plan-load-error-heading" className="space-y-3">
          <h2 id="plan-load-error-heading" className="text-lg font-semibold text-text-primary">Your plan is temporarily unavailable</h2>
          <ErrorRecoveryRenderer error={state.error} onRetry={() => void load()} />
        </section>
        <AdvisoryLinks />
      </div>
    );
  }

  return <PlanContent response={state.response} />;
}

function PlanContent({ response }: { readonly response: PlanSetResponse }): JSX.Element {
  if (response.status === 'insufficient_data') {
    return (
      <div className="space-y-5">
        <InsufficientData
          heading="Not enough grounded state for a plan"
          headingLevel={2}
          reason={response.reason}
          next={[
            { id: 'profile-goals', label: 'Add or confirm your profile and goals in You', href: '/you' },
            { id: 'pipeline', label: 'Build real pipeline state in Opportunities', href: '/opportunities' },
          ]}
        />
        <AdvisoryLinks />
      </div>
    );
  }

  const todaysPlan = response.plans.find((plan) => plan.horizon === '30d');
  const todaysMove = response.todaysMove;
  const todaysAction = todaysPlan?.actions.find((action) => action.id === todaysMove?.actionId);
  const groundedToday = todaysMove !== null
    && todaysPlan !== undefined
    && todaysPlan.goalRefs.length > 0
    && todaysAction !== undefined
    && todaysAction.evidenceRefs.length > 0;

  return (
    <div className="space-y-6" data-testid="populated-plan">
      <section aria-labelledby="todays-move-heading" className="rounded-lg border border-border-strong bg-bg-elevated p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">From your active 30-day plan</p>
            <h2 id="todays-move-heading" className="mt-1 text-lg font-semibold text-text-primary">Today&apos;s move</h2>
          </div>
          <TierBadge tier="green" label="Advisory · no action runs here" />
        </div>
        {groundedToday ? (
          <div className="mt-4" data-testid="grounded-todays-move">
            <p className="font-semibold text-text-primary">{todaysMove.title}</p>
            <GroundingDetails action={todaysAction} plan={todaysPlan} />
          </div>
        ) : (
          <InsufficientData
            className="mt-4"
            heading="No grounded move for today"
            reason="The backend did not return a 30-day action with resolvable grounding, so CareerOS did not invent one."
            next={[{ id: 'review-state', label: 'Review your profile and goals in You', href: '/you' }]}
          />
        )}
      </section>

      <section aria-labelledby="milestones-heading">
        <h2 id="milestones-heading" className="text-lg font-semibold text-text-primary">Next actions and milestones</h2>
        <p className="mt-1 text-sm text-text-secondary">Only active horizons and dates supplied by the backend are shown.</p>
        <div className="mt-4 space-y-5">
          {response.plans.map((plan) => <HorizonPlan key={plan.id} plan={plan} />)}
        </div>
      </section>

      <AdvisoryLinks />
    </div>
  );
}

function HorizonPlan({ plan }: { readonly plan: PlanResponse }): JSX.Element {
  const groundedPlan = plan.goalRefs.length > 0;
  return (
    <article aria-labelledby={`plan-${plan.id}-heading`} className="rounded-lg border border-border-subtle bg-bg-elevated p-5" data-testid={`horizon-plan-${plan.horizon}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{HORIZON_LABEL[plan.horizon]}</p>
          <h3 id={`plan-${plan.id}-heading`} className="mt-1 text-base font-semibold text-text-primary">
            {groundedPlan ? plan.summary : 'Grounding unavailable for this horizon'}
          </h3>
        </div>
        <p className="text-xs text-text-muted">Updated {formatBackendDate(plan.updatedAt)}</p>
      </div>

      {!groundedPlan ? (
        <InsufficientData
          className="mt-4"
          heading="No stated-goal grounding"
          reason="This plan has no goal references in the public contract, so its generated details are hidden."
          next={[{ id: 'goals', label: 'Confirm your goals in You', href: '/you' }]}
        />
      ) : (
        <>
          {plan.diffSummary ? <p className="mt-3 rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm text-text-secondary">Plan change: {plan.diffSummary}</p> : null}
          {plan.rationale ? <p className="mt-3 text-sm text-text-secondary">Why this horizon: {plan.rationale}</p> : null}
          <p className="mt-3 text-xs text-text-muted">Goal provenance: {plan.goalRefs.join(', ')}</p>

          {plan.actions.length === 0 ? (
            <InsufficientData
              className="mt-4"
              heading="No grounded actions returned"
              reason="This active horizon contains no backend-supplied actions. CareerOS did not create a placeholder milestone."
              next={[{ id: 'opportunities', label: 'Add real opportunity state', href: '/opportunities' }]}
            />
          ) : (
            <ol className="mt-4 space-y-3" aria-label={`${HORIZON_LABEL[plan.horizon]} grounded actions`}>
              {plan.actions.map((action, index) => (
                <li key={action.id}>
                  <GroundedAction action={action} plan={plan} index={index} />
                </li>
              ))}
            </ol>
          )}
          <p className="mt-4 text-xs text-text-muted">Generation provenance: post-guardrail model {plan.modelVersion} · created {formatBackendDate(plan.createdAt)}</p>
        </>
      )}
    </article>
  );
}

function GroundedAction({ action, plan, index }: { readonly action: PlanActionResponse; readonly plan: PlanResponse; readonly index: number }): JSX.Element {
  if (action.evidenceRefs.length === 0) {
    return (
      <InsufficientData
        heading={`Action ${String(index + 1)} has no grounding`}
        reason="The backend returned no evidence references for this generated action, so its title and rationale are not shown."
        next={[{ id: 'profile', label: 'Add grounded state in You', href: '/you' }]}
      />
    );
  }

  return (
    <article aria-labelledby={`plan-action-${action.id}`} className="rounded-md border border-border-subtle bg-bg-subtle p-4" data-testid={`grounded-plan-action-${action.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 id={`plan-action-${action.id}`} className="font-semibold text-text-primary">{action.title}</h4>
        <span className="text-xs font-medium text-text-secondary">{action.status.replaceAll('_', ' ')} · {String(action.progress)}% recorded</span>
      </div>
      <p className="mt-2 text-sm text-text-secondary">{action.rationale}</p>
      <GroundingDetails action={action} plan={plan} />
    </article>
  );
}

function GroundingDetails({ action, plan }: { readonly action: PlanActionResponse; readonly plan: PlanResponse }): JSX.Element {
  return (
    <dl className="mt-3 grid gap-2 text-xs text-text-muted sm:grid-cols-2">
      <div><dt className="font-semibold text-text-secondary">Stated-goal provenance</dt><dd>{plan.goalRefs.join(', ')}</dd></div>
      <div><dt className="font-semibold text-text-secondary">Grounding references</dt><dd>{action.evidenceRefs.join(', ')}</dd></div>
    </dl>
  );
}

function AdvisoryLinks(): JSX.Element {
  return (
    <nav aria-label="Rooms where plan actions happen" className="rounded-lg border border-border-subtle bg-bg-subtle p-4">
      <h2 className="text-sm font-semibold text-text-primary">Continue in the room where the work happens</h2>
      <p className="mt-1 text-sm text-text-secondary">Plan is advisory and executes no Green, Yellow, or Red action inline.</p>
      <ul className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
        <li><Link href="/opportunities" className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Open Opportunities</Link></li>
        <li><Link href="/you" className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Open You</Link></li>
        <li><Link href="/approvals" className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Open Approvals</Link></li>
      </ul>
    </nav>
  );
}