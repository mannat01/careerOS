'use client';

import {
  applicationListResponseSchema,
  opportunityDetailSchema,
  skillGapsQuerySchema,
  skillGapsResponseSchema,
  type ApplicationListResponse,
  type OpportunityDetail,
  type SkillGap,
  type SkillGapsQuery,
  type SkillGapsResponse,
} from '@careeros/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiClient, createApi } from '@/api';
import { ErrorRecoveryRenderer, RouteSkeleton } from '@/shell/state';
import { InsufficientData } from '@/trust';

export interface SkillsRoomDependencies {
  readonly listApplications: () => Promise<ApplicationListResponse>;
  readonly getOpportunity: (id: string) => Promise<OpportunityDetail>;
  readonly getGaps: (query: SkillGapsQuery) => Promise<SkillGapsResponse>;
}

interface PipelineOpportunity {
  readonly applicationId: string;
  readonly detail: OpportunityDetail;
}

type AnalysisState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: ApiError }
  | { readonly kind: 'ready'; readonly response: SkillGapsResponse };

type RoomState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: ApiError }
  | { readonly kind: 'ready'; readonly opportunities: readonly PipelineOpportunity[] };

function productionDependencies(): SkillsRoomDependencies {
  const api = createApi(apiClient());
  return {
    listApplications: () => api.applications.list(),
    getOpportunity: (id) => api.opportunities.get(id),
    getGaps: (query) => api.skills.get(query),
  };
}

function asApiError(cause: unknown, fallback: string): ApiError {
  return cause instanceof ApiError ? cause : new ApiError({
    code: 'internal',
    message: cause instanceof Error ? cause.message : fallback,
  });
}

function isNotOwned(error: ApiError): boolean {
  return error.code === 'capability_denied' && error.details?.['reason'] === 'opportunity_not_owned';
}

export function SkillsRoomClient({ dependencies }: { readonly dependencies?: SkillsRoomDependencies }): JSX.Element {
  const [deps] = useState(() => dependencies ?? productionDependencies());
  const [room, setRoom] = useState<RoomState>({ kind: 'loading' });
  const [analysis, setAnalysis] = useState<AnalysisState>({ kind: 'loading' });
  const [selectedId, setSelectedId] = useState('');

  const loadAnalysis = useCallback(async (opportunityId?: string): Promise<void> => {
    setAnalysis({ kind: 'loading' });
    try {
      const query = skillGapsQuerySchema.parse(opportunityId ? { opportunityId } : {});
      const response = skillGapsResponseSchema.parse(await deps.getGaps(query));
      setAnalysis({ kind: 'ready', response });
    } catch (cause) {
      setAnalysis({ kind: 'error', error: asApiError(cause, 'The skills analysis could not be loaded.') });
    }
  }, [deps]);

  const load = useCallback(async (): Promise<void> => {
    setRoom({ kind: 'loading' });
    setSelectedId('');
    setAnalysis({ kind: 'loading' });
    try {
      const [applications, response] = await Promise.all([
        deps.listApplications(),
        deps.getGaps(skillGapsQuerySchema.parse({})),
      ]);
      const parsedApplications = applicationListResponseSchema.parse(applications);
      const opportunities = await Promise.all(parsedApplications.data.map(async (application) => ({
        applicationId: application.id,
        detail: opportunityDetailSchema.parse(await deps.getOpportunity(application.opportunityId)),
      })));
      setRoom({ kind: 'ready', opportunities });
      setAnalysis({ kind: 'ready', response: skillGapsResponseSchema.parse(response) });
    } catch (cause) {
      const error = asApiError(cause, 'The Skills room could not be loaded.');
      setRoom({ kind: 'error', error });
      setAnalysis({ kind: 'error', error });
    }
  }, [deps]);

  useEffect(() => { void load(); }, [load]);

  if (room.kind === 'loading') {
    return <RouteSkeleton label="Loading your grounded skills analysis…" testId="skills-loading" />;
  }
  if (room.kind === 'error') {
    return (
      <div className="space-y-5">
        <ErrorRecoveryRenderer error={room.error} onRetry={() => void load()} />
        <AdvisoryLinks />
      </div>
    );
  }

  async function chooseScope(value: string): Promise<void> {
    setSelectedId(value);
    await loadAnalysis(value || undefined);
  }

  return (
    <div className="flex flex-col gap-6" data-testid="skills-room">
      <section aria-labelledby="skills-scope-heading" className="rounded-lg border border-border-subtle bg-bg-elevated p-5">
        <h2 id="skills-scope-heading" className="text-lg font-semibold text-text-primary">Analysis scope</h2>
        <p className="mt-1 text-sm text-text-secondary">The default shows aggregate and per-opportunity gaps. Optionally focus on one opportunity already stored in your pipeline.</p>
        <label className="mt-4 flex max-w-xl flex-col gap-1 text-sm font-medium text-text-primary">
          Pipeline opportunity
          <select
            value={selectedId}
            onChange={(event) => void chooseScope(event.target.value)}
            className="rounded-md border border-border-subtle bg-bg-subtle px-3 py-2 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base"
          >
            <option value="">Full analysis · all grounded gaps</option>
            {room.opportunities.map(({ detail }) => (
              <option key={detail.id} value={detail.id}>{detail.role} · {detail.company}</option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-xs text-text-muted">Options come only from GET /v1/applications. The global opportunity browse list is never used.</p>
        {room.opportunities.length === 0 ? (
          <p className="mt-3 text-sm text-text-secondary">There are no pipeline opportunities to scope to. The full aggregate analysis remains available.</p>
        ) : null}
      </section>

      {analysis.kind === 'loading' ? <RouteSkeleton label="Loading scoped skills analysis…" testId="skills-analysis-loading" /> : null}
      {analysis.kind === 'error' ? (
        <SkillsRecovery
          error={analysis.error}
          onRetry={() => void loadAnalysis(selectedId || undefined)}
          onReload={() => void load()}
        />
      ) : null}
      {analysis.kind === 'ready' ? <AnalysisContent response={analysis.response} scoped={selectedId.length > 0} /> : null}
      <AdvisoryLinks />
    </div>
  );
}

function AnalysisContent({ response, scoped }: { readonly response: SkillGapsResponse; readonly scoped: boolean }): JSX.Element {
  if (response.status === 'insufficient_data') {
    return (
      <InsufficientData
        heading="Not enough to analyze"
        headingLevel={2}
        reason={scoped
          ? 'The selected pipeline opportunity does not have enough real requirements and profile signal for a grounded gap analysis.'
          : 'Your profile and pipeline do not yet contain enough real signal for a grounded skills-gap analysis.'}
        next={[
          { id: 'you', label: 'Add or confirm real profile facts in You', href: '/you' },
          { id: 'opportunities', label: 'Build real pipeline state in Opportunities', href: '/opportunities' },
        ]}
      />
    );
  }

  if (response.gaps.length === 0) {
    return (
      <section role="status" data-testid="skills-analyzed-empty" className="rounded-lg border border-tier-green bg-bg-subtle p-5">
        <h2 className="text-lg font-semibold text-text-primary">Analyzed — no gaps found</h2>
        <p className="mt-2 text-sm text-text-secondary">The backend completed the grounded analysis and returned no skill gaps for this scope. This is a good result, not missing data.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="skills-gaps-heading" data-testid="populated-skill-gaps">
      <h2 id="skills-gaps-heading" className="text-xl font-semibold text-text-primary">Grounded skill gaps</h2>
      <p className="mt-1 text-sm text-text-secondary">Every item below is backend-supplied and traces to typed evidence. Severity and source are rendered exactly as returned.</p>
      <ul className="mt-4 grid gap-4" aria-label="Grounded skill gaps">
        {response.gaps.map((gap) => <li key={gap.id}><GapCard gap={gap} /></li>)}
      </ul>
    </section>
  );
}

function GapCard({ gap }: { readonly gap: SkillGap }): JSX.Element {
  return (
    <article aria-labelledby={`skill-gap-${gap.id}`} data-testid={`skill-gap-${gap.source}`} className="rounded-lg border border-border-subtle bg-bg-elevated p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`skill-gap-${gap.id}`} className="text-lg font-semibold text-text-primary">{gap.skill.replaceAll('_', ' ')}</h3>
          <p className="mt-2 text-sm text-text-secondary">{gap.gap}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full border border-border-subtle bg-bg-subtle px-2 py-1">Severity: {gap.severity}</span>
          <span className="rounded-full border border-border-subtle bg-bg-subtle px-2 py-1">Source: {gap.source === 'per_opp' ? 'per_opp · pipeline opportunity' : 'aggregate · profile and targets'}</span>
        </div>
      </div>
      {gap.source === 'per_opp' ? <PerOpportunityGrounding gap={gap} /> : <AggregateGrounding gap={gap} />}
      <p className="mt-4 text-xs text-text-muted">Grounded analysis: {gap.modelVersion} · computed {new Date(gap.computedAt).toLocaleDateString('en-US')}</p>
    </article>
  );
}

function PerOpportunityGrounding({ gap }: { readonly gap: Extract<SkillGap, { source: 'per_opp' }> }): JSX.Element {
  const requirements = gap.evidenceRefs.filter((ref) => ref.kind === 'opportunity_requirement');
  const subscores = gap.evidenceRefs.filter((ref) => ref.kind === 'match_subscore');
  return (
    <section aria-label={`Grounding for ${gap.skill}`} className="mt-4 rounded-md border border-border-subtle bg-bg-subtle p-4">
      <h4 className="font-semibold text-text-primary">Opportunity grounding</h4>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold text-text-secondary">Real role requirement</dt><dd>{requirements.map((ref) => ref.requirement).join(', ')}</dd></div>
        <div><dt className="font-semibold text-text-secondary">Resolved match subscore</dt><dd>{subscores.map((ref) => `${ref.key}: ${String(ref.value)} / 100`).join(', ')}</dd></div>
        <div className="sm:col-span-2"><dt className="font-semibold text-text-secondary">Stored opportunity</dt><dd>{gap.opportunityId}</dd></div>
      </dl>
    </section>
  );
}

function AggregateGrounding({ gap }: { readonly gap: Extract<SkillGap, { source: 'aggregate' }> }): JSX.Element {
  const dimensions = gap.evidenceRefs.filter((ref) => ref.kind === 'state_dimension');
  const roles = gap.evidenceRefs.filter((ref) => ref.kind === 'target_role');
  return (
    <section aria-label={`Grounding for ${gap.skill}`} className="mt-4 rounded-md border border-border-subtle bg-bg-subtle p-4">
      <h4 className="font-semibold text-text-primary">Profile and target grounding</h4>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold text-text-secondary">State dimension</dt><dd>{dimensions.map((ref) => `${ref.dimension.replaceAll('_', ' ')} · ${ref.signal}`).join(', ')}</dd></div>
        <div><dt className="font-semibold text-text-secondary">Stated target role</dt><dd>{roles.map((ref) => ref.role).join(', ')}</dd></div>
      </dl>
    </section>
  );
}

function SkillsRecovery({ error, onRetry, onReload }: { readonly error: ApiError; readonly onRetry: () => void; readonly onReload: () => void }): JSX.Element {
  if (isNotOwned(error)) {
    return (
      <section role="alert" data-testid="skills-not-owned-recovery" className="rounded-lg border border-border-subtle bg-bg-subtle p-4 text-sm">
        <h2 className="font-semibold text-text-primary">That opportunity is no longer in your pipeline</h2>
        <p className="mt-1 text-text-secondary">{error.message} Reload the caller-scoped options or review your pipeline.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" onClick={onReload} className="rounded-md border border-brand-base px-3 py-1 text-brand-base focus-visible:ring-2 focus-visible:ring-brand-base">Reload pipeline opportunities</button>
          <Link href="/opportunities/pipeline" className="rounded-md border border-border-subtle px-3 py-1 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base">Review pipeline</Link>
        </div>
      </section>
    );
  }
  return (
    <div className="space-y-3">
      <ErrorRecoveryRenderer error={error} onRetry={onRetry} />
      {(error.code === 'not_found' || error.code === 'validation_failed') ? (
        <div className="flex flex-wrap gap-3 text-sm">
          <button type="button" onClick={onReload} className="rounded-md border border-brand-base px-3 py-1 text-brand-base focus-visible:ring-2 focus-visible:ring-brand-base">Reload Skills room</button>
          <Link href="/opportunities/pipeline" className="rounded-md border border-border-subtle px-3 py-1 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base">Choose from pipeline</Link>
        </div>
      ) : null}
    </div>
  );
}

function AdvisoryLinks(): JSX.Element {
  return (
    <nav aria-label="Rooms where skills work happens" className="rounded-lg border border-border-subtle bg-bg-subtle p-4">
      <h2 className="text-sm font-semibold text-text-primary">Continue where the work happens</h2>
      <p className="mt-1 text-sm text-text-secondary">Skills is advisory and executes no Green, Yellow, or Red action inline.</p>
      <ul className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
        <li><Link href="/you" className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Open You</Link></li>
        <li><Link href="/plan" className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Open Plan</Link></li>
        <li><Link href="/opportunities" className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Open Opportunities</Link></li>
      </ul>
    </nav>
  );
}