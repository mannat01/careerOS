'use client';

import {
  dashboardDetailResponseSchema,
  dashboardListResponseSchema,
  dashboardMetricSchema,
  type DashboardDetailResponse,
  type DashboardListResponse,
  type DashboardMetric,
  type DashboardMetricEvidenceRef,
  type DashboardMetricKey,
  type DashboardResolvedEvidence,
} from '@careeros/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiClient, createApi } from '@/api';
import { ErrorRecoveryRenderer, ListSkeleton } from '@/shell/state';
import {
  AiSurface,
  ConfidenceChip,
  InsufficientData,
  bandFor,
  type Confidence,
  type Evidence,
} from '@/trust';

export interface DashboardsRoomDependencies {
  readonly list: () => Promise<DashboardListResponse>;
  readonly detail: (metric: DashboardMetricKey) => Promise<DashboardDetailResponse>;
}

type RoomState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: ApiError }
  | { readonly kind: 'ready'; readonly response: DashboardListResponse };

type DetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: ApiError }
  | { readonly kind: 'ready'; readonly detail: DashboardDetailResponse };

const METRIC_LABELS: Readonly<Record<DashboardMetricKey, string>> = {
  career_momentum: 'Career momentum',
  interview_readiness: 'Interview readiness',
  skill_momentum: 'Skill momentum',
  market_positioning: 'Market positioning',
  salary_trajectory: 'Salary trajectory',
  opportunity_quality: 'Opportunity quality',
  networking_strength: 'Networking strength',
  recruiter_engagement: 'Recruiter engagement',
  portfolio_completeness: 'Portfolio completeness',
  strategic_recommendations: 'Strategic recommendations',
};

const EVIDENCE_SOURCE: Readonly<Record<DashboardMetricEvidenceRef['kind'], string>> = {
  profile_fact: 'Profile fact',
  graph_node: 'Career graph node',
  research_finding: 'Sanctioned research finding',
  plan_action: 'Plan action',
};

function productionDependencies(): DashboardsRoomDependencies {
  const dashboards = createApi(apiClient()).dashboards;
  return {
    list: () => dashboards.list(),
    detail: (metric) => dashboards.detail(metric),
  };
}

function asApiError(cause: unknown, fallback: string): ApiError {
  return cause instanceof ApiError ? cause : new ApiError({
    code: 'internal',
    message: cause instanceof Error ? cause.message : fallback,
  });
}

function confidenceFor(metric: Extract<DashboardMetric, { status: 'ok' }>): Confidence {
  return {
    value: metric.confidence,
    band: bandFor(metric.confidence),
    source: metric.modelVersion,
  };
}

function trustEvidence(refs: readonly DashboardMetricEvidenceRef[]): Evidence[] {
  return refs.map((ref) => ({
    id: ref.id,
    source: EVIDENCE_SOURCE[ref.kind],
    snippet: ref.id,
  }));
}

function formatFreshness(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(value));
}

export function DashboardsRoomClient({ dependencies }: { readonly dependencies?: DashboardsRoomDependencies }): JSX.Element {
  const [deps] = useState(() => dependencies ?? productionDependencies());
  const [room, setRoom] = useState<RoomState>({ kind: 'loading' });
  const [selectedMetric, setSelectedMetric] = useState<DashboardMetricKey | null>(null);
  const [details, setDetails] = useState<Partial<Record<DashboardMetricKey, DetailState>>>({});

  const load = useCallback(async (): Promise<void> => {
    setRoom({ kind: 'loading' });
    setSelectedMetric(null);
    setDetails({});
    try {
      const response = dashboardListResponseSchema.parse(await deps.list());
      const metrics = response.metrics.map((metric) => dashboardMetricSchema.parse(metric));
      setRoom({ kind: 'ready', response: dashboardListResponseSchema.parse({ ...response, metrics }) });
    } catch (cause) {
      setRoom({ kind: 'error', error: asApiError(cause, 'Dashboard metrics could not be loaded.') });
    }
  }, [deps]);

  const loadDetail = useCallback(async (metric: DashboardMetricKey): Promise<void> => {
    setSelectedMetric(metric);
    setDetails((current) => ({ ...current, [metric]: { kind: 'loading' } }));
    try {
      const detail = dashboardDetailResponseSchema.parse(await deps.detail(metric));
      if (detail.metric !== metric) {
        throw new ApiError({
          code: 'internal',
          message: 'Metric detail did not match the selected dashboard card.',
          details: { requestedMetric: metric, returnedMetric: detail.metric },
        });
      }
      setDetails((current) => ({ ...current, [metric]: { kind: 'ready', detail } }));
    } catch (cause) {
      setDetails((current) => ({
        ...current,
        [metric]: { kind: 'error', error: asApiError(cause, 'Metric evidence could not be loaded.') },
      }));
    }
  }, [deps]);

  useEffect(() => { void load(); }, [load]);

  if (room.kind === 'loading') {
    return <ListSkeleton rows={10} label="Loading scored dashboard metrics…" testId="dashboards-loading" />;
  }
  if (room.kind === 'error') {
    return (
      <section aria-labelledby="dashboards-error-heading" className="space-y-3">
        <h2 id="dashboards-error-heading" className="text-lg font-semibold text-text-primary">Dashboards are temporarily unavailable</h2>
        <ErrorRecoveryRenderer error={room.error} onRetry={() => void load()} />
      </section>
    );
  }

  return (
    <div className="space-y-5" data-testid="dashboards-room">
      <p className="text-sm text-text-secondary">
        Every displayed score, trend, explanation, confidence, and timestamp comes from the parsed dashboard response.
      </p>
      <ul aria-label="Intelligence dashboard metrics" className="grid gap-4 lg:grid-cols-2">
        {room.response.metrics.map((metric) => {
          const detail = selectedMetric === metric.metric ? details[metric.metric] : undefined;
          return (
            <li key={metric.metric}>
              <MetricCard
                metric={metric}
                detail={detail}
                onOpen={() => void loadDetail(metric.metric)}
              />
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-text-muted">
        Dashboard response model: {room.response.modelVersion} · generated{' '}
        <time dateTime={room.response.freshness.generatedAt}>{formatFreshness(room.response.freshness.generatedAt)}</time>
      </p>
      <nav aria-label="Rooms where dashboard actions happen" className="rounded-lg border border-border-subtle bg-bg-subtle p-4">
        <h2 className="text-sm font-semibold text-text-primary">Continue where the work happens</h2>
        <p className="mt-1 text-sm text-text-secondary">Dashboards is advisory and executes no Green, Yellow, or Red action inline.</p>
        <ul className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
          <li><Link href="/plan" className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Open Plan</Link></li>
          <li><Link href="/plan/skills" className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Open Skills</Link></li>
          <li><Link href="/opportunities" className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Open Opportunities</Link></li>
        </ul>
      </nav>
    </div>
  );
}

function MetricCard({
  metric,
  detail,
  onOpen,
}: {
  readonly metric: DashboardMetric;
  readonly detail: DetailState | undefined;
  readonly onOpen: () => void;
}): JSX.Element {
  const label = METRIC_LABELS[metric.metric];
  const body = metric.status === 'ok' ? (
    <div data-testid={`metric-card-${metric.metric}`}>
      <AiSurface
        evidence={trustEvidence(metric.evidenceRefs)}
        confidence={confidenceFor(metric)}
        label={`${label} scored metric`}
        className="rounded-lg border border-border-subtle bg-bg-elevated p-5"
      >
        <MetricHeading metric={metric} label={label} />
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <p><span className="sr-only">Backend value: </span><strong className="text-3xl text-text-primary">{String(metric.value)}</strong></p>
          <ConfidenceChip confidence={confidenceFor(metric)} />
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="font-semibold text-text-secondary">Backend trend</dt><dd className="capitalize text-text-primary">{metric.trend}</dd></div>
          <div><dt className="font-semibold text-text-secondary">Computed</dt><dd><time dateTime={metric.freshness.computedAt}>{formatFreshness(metric.freshness.computedAt)}</time></dd></div>
        </dl>
        <p className="mt-4 text-sm text-text-secondary">{metric.explanation}</p>
        <CardNavigation metric={metric} />
        <DetailControl metric={metric.metric} label={label} detail={detail} onOpen={onOpen} />
      </AiSurface>
    </div>
  ) : (
    <article aria-labelledby={`metric-${metric.metric}`} className="rounded-lg border border-border-subtle bg-bg-elevated p-5" data-testid={`metric-card-${metric.metric}`}>
      <MetricHeading metric={metric} label={label} />
      <InsufficientData
        className="mt-4"
        heading={`${label}: not enough signal yet`}
        reason={metric.explanation}
        next={[
          { id: `${metric.metric}-profile`, label: 'Add grounded profile signal in You', href: '/you' },
          { id: `${metric.metric}-pipeline`, label: 'Build real activity in Opportunities', href: '/opportunities' },
        ]}
      />
      <DetailControl metric={metric.metric} label={label} detail={detail} onOpen={onOpen} />
    </article>
  );
  return body;
}

function MetricHeading({ metric, label }: { readonly metric: DashboardMetric; readonly label: string }): JSX.Element {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id={`metric-${metric.metric}`} className="text-lg font-semibold text-text-primary">{label}</h2>
        <p className="text-xs text-text-muted">{metric.metric}</p>
      </div>
      <span className="rounded-full border border-border-subtle px-2 py-0.5 text-xs text-text-secondary">{metric.status.replaceAll('_', ' ')}</span>
    </header>
  );
}

function CardNavigation({ metric }: { readonly metric: Extract<DashboardMetric, { status: 'ok' }> }): JSX.Element | null {
  if (!metric.linkedAction) return null;
  const href = `/plan#plan-action-${encodeURIComponent(metric.linkedAction.id)}`;
  return (
    <p className="mt-4 text-sm">
      <Link href={href} className="font-semibold text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">
        Open linked plan action: {metric.linkedAction.title ?? metric.linkedAction.id}
      </Link>
    </p>
  );
}

function DetailControl({
  metric,
  label,
  detail,
  onOpen,
}: {
  readonly metric: DashboardMetricKey;
  readonly label: string;
  readonly detail: DetailState | undefined;
  readonly onOpen: () => void;
}): JSX.Element {
  return (
    <div className="mt-5 border-t border-border-subtle pt-4">
      <button
        type="button"
        onClick={onOpen}
        disabled={detail?.kind === 'loading'}
        aria-expanded={detail !== undefined}
        aria-controls={`metric-detail-${metric}`}
        className="rounded-md border border-brand-base px-3 py-1.5 text-sm font-semibold text-brand-base focus-visible:ring-2 focus-visible:ring-brand-base"
      >
        {detail?.kind === 'loading' ? `Loading evidence for ${label}…` : `View resolved evidence for ${label}`}
      </button>
      {detail ? <MetricDetail metric={metric} state={detail} onRetry={onOpen} /> : null}
    </div>
  );
}

function MetricDetail({ metric, state, onRetry }: { readonly metric: DashboardMetricKey; readonly state: DetailState; readonly onRetry: () => void }): JSX.Element {
  if (state.kind === 'loading') {
    return <p id={`metric-detail-${metric}`} role="status" className="mt-3 text-sm text-text-secondary">Loading resolved evidence…</p>;
  }
  if (state.kind === 'error') {
    return (
      <section id={`metric-detail-${metric}`} aria-label={`${METRIC_LABELS[metric]} evidence recovery`} className="mt-3 space-y-2" data-testid={`metric-detail-error-${metric}`}>
        <ErrorRecoveryRenderer error={state.error} onRetry={onRetry} />
        {state.error.code === 'not_found' ? (
          <button type="button" onClick={onRetry} className="rounded-md border border-brand-base px-3 py-1 text-sm text-brand-base focus-visible:ring-2 focus-visible:ring-brand-base">Retry this metric detail</button>
        ) : null}
      </section>
    );
  }
  return (
    <section id={`metric-detail-${metric}`} aria-labelledby={`metric-detail-heading-${metric}`} className="mt-4 rounded-md border border-border-subtle bg-bg-subtle p-4" data-testid={`metric-detail-${metric}`}>
      <h3 id={`metric-detail-heading-${metric}`} className="font-semibold text-text-primary">Resolved evidence</h3>
      {state.detail.evidence.length > 0 ? (
        <ul className="mt-3 space-y-3" aria-label={`${METRIC_LABELS[metric]} resolved evidence`}>
          {state.detail.evidence.map((evidence) => <ResolvedEvidenceItem key={`${evidence.kind}:${evidence.id}`} evidence={evidence} />)}
        </ul>
      ) : (
        <InsufficientData
          className="mt-3"
          heading="No resolved evidence returned"
          reason="The parsed detail response contains no resolved evidence entries."
          next={[]}
        />
      )}
    </section>
  );
}

function ResolvedEvidenceItem({ evidence }: { readonly evidence: DashboardResolvedEvidence }): JSX.Element {
  return (
    <li className="text-sm">
      <p className="font-medium text-text-primary">{evidence.label}</p>
      <p className="text-xs text-text-muted">{EVIDENCE_SOURCE[evidence.kind]} · {evidence.id}</p>
    </li>
  );
}