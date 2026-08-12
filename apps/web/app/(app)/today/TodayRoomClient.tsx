'use client';

import {
  applicationListResponseSchema,
  briefingLatestResponseSchema,
  pendingApprovalListResponseSchema,
  type Application,
  type ApplicationListResponse,
  type ApplicationStatus,
  type BriefingItem,
  type BriefingLatestResponse,
  type PendingApprovalListResponse,
} from '@careeros/contracts';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiClient, createApi } from '@/api';
import { setPendingApprovalsCount } from '@/shell';
import { ErrorRecoveryRenderer, ListSkeleton } from '@/shell/state';
import { AiSurface, InsufficientData, TierBadge, bandFor, type Confidence, type Evidence } from '@/trust';

const APPROVAL_PREVIEW_LIMIT = 3;

export const TODAY_PIPELINE_STAGES: readonly ApplicationStatus[] = [
  'saved', 'drafting', 'ready', 'applied', 'screening', 'interviewing', 'offer', 'closed',
] as const;

const STAGE_LABEL: Readonly<Record<ApplicationStatus, string>> = {
  saved: 'Saved',
  drafting: 'Drafting',
  ready: 'Ready',
  applied: 'Applied',
  screening: 'Screening',
  interviewing: 'Interviewing',
  offer: 'Offer',
  closed: 'Closed',
};

export interface TodayRoomDependencies {
  readonly pendingApprovals: () => Promise<PendingApprovalListResponse>;
  readonly latestBriefing: () => Promise<BriefingLatestResponse>;
  readonly applications: () => Promise<ApplicationListResponse>;
}

type CardState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: T }
  | { readonly kind: 'error'; readonly error: ApiError };

function productionDependencies(): TodayRoomDependencies {
  const api = createApi(apiClient());
  return {
    pendingApprovals: () => api.approvals.listPending(),
    latestBriefing: () => api.briefings.latest(),
    applications: () => api.applications.list(),
  };
}

function asApiError(cause: unknown, fallback: string): ApiError {
  return cause instanceof ApiError ? cause : new ApiError({
    code: 'internal',
    message: cause instanceof Error ? cause.message : fallback,
  });
}

function useCard<T>(load: () => Promise<T>, fallback: string): readonly [CardState<T>, () => void] {
  const [state, setState] = useState<CardState<T>>({ kind: 'loading' });
  const reload = useCallback((): void => {
    setState({ kind: 'loading' });
    void load().then(
      (data) => setState({ kind: 'ready', data }),
      (cause: unknown) => setState({ kind: 'error', error: asApiError(cause, fallback) }),
    );
  }, [fallback, load]);
  useEffect(reload, [reload]);
  return [state, reload] as const;
}

function Card({
  id,
  title,
  endpoint,
  href,
  linkLabel,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly endpoint: string;
  readonly href?: string;
  readonly linkLabel?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <article aria-labelledby={`${id}-heading`} data-testid={`today-card-${id}`} className="rounded-xl border border-border-subtle bg-bg-elevated p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-heading`} className="text-lg font-semibold text-text-primary">{title}</h2>
          <p className="mt-1 text-xs text-text-muted">Source: <code>{endpoint}</code></p>
        </div>
        {href && linkLabel ? (
          <a href={href} className="text-sm font-semibold text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">
            {linkLabel}
          </a>
        ) : null}
      </header>
      <div className="mt-4">{children}</div>
    </article>
  );
}

function ApprovalsCard({ dependencies }: { readonly dependencies: TodayRoomDependencies }): JSX.Element {
  const load = useCallback(async (): Promise<PendingApprovalListResponse> => {
    const response = pendingApprovalListResponseSchema.parse(await dependencies.pendingApprovals());
    setPendingApprovalsCount(response.data.length);
    return response;
  }, [dependencies]);
  const [state, reload] = useCard(load, 'Pending approvals could not be loaded.');

  return (
    <Card id="approvals" title="What needs you" endpoint="GET /v1/approvals/pending" href="/approvals" linkLabel="Open Approvals">
      {state.kind === 'loading' ? <ListSkeleton rows={2} label="Loading pending approvals…" /> : null}
      {state.kind === 'error' ? <ErrorRecoveryRenderer error={state.error} onRetry={reload} /> : null}
      {state.kind === 'ready' && state.data.data.length === 0 ? (
        <p role="status" className="text-sm text-text-secondary">Nothing is waiting for your decision.</p>
      ) : null}
      {state.kind === 'ready' && state.data.data.length > 0 ? (
        <>
          <p className="text-sm text-text-secondary">
            <strong className="text-2xl text-text-primary" data-testid="pending-approval-count">{state.data.data.length}</strong>{' '}
            {state.data.data.length === 1 ? 'decision is' : 'decisions are'} waiting.
          </p>
          <ul className="mt-4 space-y-3" aria-label="Pending approval preview">
            {state.data.data.slice(0, APPROVAL_PREVIEW_LIMIT).map((approval) => (
              <li key={approval.id} className="rounded-md border border-border-subtle bg-bg-subtle p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-text-primary">{approval.action}</p>
                    <p className="mt-1 text-sm text-text-secondary">{approval.why}</p>
                  </div>
                  <TierBadge tier={approval.tier} />
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

interface GroundedBriefingClaim {
  readonly text: string;
  readonly evidence: readonly Evidence[];
  readonly confidence: Confidence;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function groundedClaim(item: BriefingItem): GroundedBriefingClaim | null {
  const text = nonEmptyString(item.payload.recommendation)
    ?? nonEmptyString(item.payload.reasoning)
    ?? nonEmptyString(item.payload.explanation)
    ?? nonEmptyString(item.payload.summary)
    ?? nonEmptyString(item.payload.text)
    ?? nonEmptyString(item.payload.title);
  const confidenceValue = item.payload.confidence;
  const modelVersion = nonEmptyString(item.payload.modelVersion);
  const evidenceRefs = Array.isArray(item.payload.evidenceRefs)
    ? item.payload.evidenceRefs.filter((ref): ref is string => nonEmptyString(ref) !== null)
    : [];

  if (
    text === null
    || typeof confidenceValue !== 'number'
    || !Number.isFinite(confidenceValue)
    || confidenceValue < 0
    || confidenceValue > 1
    || modelVersion === null
    || evidenceRefs.length === 0
  ) return null;

  return {
    text,
    evidence: evidenceRefs.map((id) => ({ id, source: modelVersion, snippet: id })),
    confidence: { value: confidenceValue, band: bandFor(confidenceValue), source: modelVersion },
  };
}

function BriefingItemView({ item }: { readonly item: BriefingItem }): JSX.Element {
  const claim = groundedClaim(item);
  return (
    <li className="rounded-md border border-border-subtle bg-bg-subtle p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium capitalize text-text-primary">{item.kind.replaceAll('_', ' ')}</p>
        <TierBadge tier={item.autonomyTier} />
      </div>
      {claim ? (
        <AiSurface
          evidence={claim.evidence}
          confidence={claim.confidence}
          tier={item.autonomyTier}
          label={`Briefing ${item.kind}`}
          className="rounded-md border border-border-subtle bg-bg-elevated p-3"
        >
          <p className="text-sm text-text-primary">{claim.text}</p>
        </AiSurface>
      ) : (
        <InsufficientData
          heading="Briefing item lacks displayable grounding"
          reason="This item did not return a claim with both evidence and confidence, so Today will not summarize it."
          next={[{ id: 'wait', label: 'Wait for a briefing item with complete grounding' }]}
        />
      )}
      <p className="mt-2 text-xs text-text-muted">State: {item.state}</p>
    </li>
  );
}

function DigestCard({ dependencies }: { readonly dependencies: TodayRoomDependencies }): JSX.Element {
  const load = useCallback(
    async (): Promise<BriefingLatestResponse> => briefingLatestResponseSchema.parse(await dependencies.latestBriefing()),
    [dependencies],
  );
  const [state, reload] = useCard(load, 'The latest briefing could not be loaded.');
  const noBriefing = state.kind === 'error' && state.error.code === 'not_found';

  return (
    <Card id="digest" title="Your day / digest" endpoint="GET /v1/briefings/latest">
      {state.kind === 'loading' ? <ListSkeleton rows={2} label="Loading your latest briefing…" /> : null}
      {state.kind === 'error' && !noBriefing ? <ErrorRecoveryRenderer error={state.error} onRetry={reload} /> : null}
      {noBriefing || (state.kind === 'ready' && state.data.items.length === 0) ? (
        <InsufficientData
          heading="No briefing yet"
          reason="No briefing items are available from the latest-briefing endpoint. Today will not invent a digest."
          next={[{ id: 'later', label: 'Check again after a scheduled or manual briefing run' }]}
        />
      ) : null}
      {state.kind === 'ready' && state.data.items.length > 0 ? (
        <>
          <p className="text-sm text-text-secondary">
            Latest run: <span className="font-medium text-text-primary">{state.data.status}</span>
            {' · '}<time dateTime={state.data.startedAt}>{state.data.startedAt}</time>
          </p>
          <ul className="mt-4 space-y-3" aria-label="Latest briefing items">
            {state.data.items.map((item) => <BriefingItemView key={item.id} item={item} />)}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

function PipelineCard({ dependencies }: { readonly dependencies: TodayRoomDependencies }): JSX.Element {
  const load = useCallback(
    async (): Promise<ApplicationListResponse> => applicationListResponseSchema.parse(await dependencies.applications()),
    [dependencies],
  );
  const [state, reload] = useCard(load, 'The application pipeline could not be loaded.');

  return (
    <Card id="pipeline" title="Pipeline at a glance" endpoint="GET /v1/applications" href="/opportunities/pipeline" linkLabel="Open pipeline board">
      {state.kind === 'loading' ? <ListSkeleton rows={2} label="Loading application pipeline…" /> : null}
      {state.kind === 'error' ? <ErrorRecoveryRenderer error={state.error} onRetry={reload} /> : null}
      {state.kind === 'ready' && state.data.data.length === 0 ? (
        <InsufficientData
          heading="Your pipeline is empty"
          reason="You have not saved any opportunities yet. Today will not invent an application or a pipeline count."
          next={[{ id: 'browse', label: 'Browse opportunities and save one', href: '/opportunities' }]}
        />
      ) : null}
      {state.kind === 'ready' && state.data.data.length > 0 ? (
        <PipelineSummary applications={state.data.data} />
      ) : null}
    </Card>
  );
}

function PipelineSummary({ applications }: { readonly applications: readonly Application[] }): JSX.Element {
  const followUps = applications
    .filter((application): application is Application & { followUpAt: string } => application.followUpAt !== null)
    .toSorted((a, b) => a.followUpAt.localeCompare(b.followUpAt));

  return (
    <>
      <div role="group" aria-label="Application counts by stage">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TODAY_PIPELINE_STAGES.map((stage) => (
            <div key={stage} className="rounded-md border border-border-subtle bg-bg-subtle p-3">
              <dt className="text-xs text-text-muted">{STAGE_LABEL[stage]}</dt>
              <dd className="text-xl font-semibold text-text-primary">{applications.filter((application) => application.status === stage).length}</dd>
            </div>
          ))}
        </dl>
      </div>
      <section aria-labelledby="pipeline-next-actions" className="mt-4">
        <h3 id="pipeline-next-actions" className="font-medium text-text-primary">Scheduled next actions</h3>
        {followUps.length > 0 ? (
          <ul className="mt-2 space-y-2 text-sm text-text-secondary">
            {followUps.map((application) => (
              <li key={application.id}>
                Follow up on opportunity {application.opportunityId} at{' '}
                <time dateTime={application.followUpAt}>{application.followUpAt}</time>
              </li>
            ))}
          </ul>
        ) : (
          <InsufficientData
            heading="No scheduled next actions"
            reason="These applications do not have a follow-up date. Today will not infer a next action from pipeline stage alone."
            next={[{ id: 'pipeline', label: 'Review applications on the pipeline board', href: '/opportunities/pipeline' }]}
          />
        )}
      </section>
    </>
  );
}

export function TodayRoomClient({ dependencies }: { readonly dependencies?: TodayRoomDependencies }): JSX.Element {
  const [deps] = useState(() => dependencies ?? productionDependencies());
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ApprovalsCard dependencies={deps} />
      <DigestCard dependencies={deps} />
      <div className="xl:col-span-2"><PipelineCard dependencies={deps} /></div>
    </div>
  );
}