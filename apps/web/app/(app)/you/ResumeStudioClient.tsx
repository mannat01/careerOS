'use client';

import type {
  ApplicationListResponse,
  OpportunityDetail,
  ResumeModel,
  ResumeTailorRequest,
  ResumeVariant,
} from '@careeros/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiClient, createApi } from '@/api';
import { ErrorRecoveryRenderer, RouteSkeleton } from '@/shell/state';
import { InsufficientData, TierBadge } from '@/trust';
import { AtsCheckPanel } from './AtsCheckPanel';

export interface ResumeStudioDependencies {
  readonly getBase: () => Promise<ResumeModel>;
  readonly listApplications: () => Promise<ApplicationListResponse>;
  readonly getOpportunity: (id: string) => Promise<OpportunityDetail>;
  readonly tailor: (resumeId: string, body: ResumeTailorRequest) => Promise<ResumeVariant>;
  readonly getVariant: (id: string) => Promise<ResumeVariant>;
}

interface PipelineOpportunity {
  readonly applicationId: string;
  readonly detail: OpportunityDetail;
}

type StudioState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'insufficient'; readonly error: ApiError }
  | { readonly kind: 'error'; readonly error: ApiError }
  | { readonly kind: 'ready'; readonly base: ResumeModel; readonly opportunities: readonly PipelineOpportunity[] };

function productionDependencies(): ResumeStudioDependencies {
  const api = createApi(apiClient());
  return {
    getBase: () => api.resumes.getBase(),
    listApplications: () => api.applications.list(),
    getOpportunity: (id) => api.opportunities.get(id),
    tailor: (id, body) => api.resumes.tailor(id, body),
    getVariant: (id) => api.resumes.getVariant(id),
  };
}

function asApiError(cause: unknown): ApiError {
  return cause instanceof ApiError ? cause : new ApiError({
    code: 'internal',
    message: cause instanceof Error ? cause.message : 'Résumé studio request failed.',
  });
}

function isInsufficient(error: ApiError): boolean {
  return error.code === 'validation_failed' && error.details?.['status'] === 'insufficient_data';
}

function isNotOwned(error: ApiError): boolean {
  return error.code === 'capability_denied' && error.details?.['reason'] === 'opportunity_not_owned';
}

export function ResumeStudioClient({ dependencies }: { readonly dependencies?: ResumeStudioDependencies }): JSX.Element {
  const [deps] = useState(() => dependencies ?? productionDependencies());
  const [state, setState] = useState<StudioState>({ kind: 'loading' });
  const [selectedId, setSelectedId] = useState('');
  const [variant, setVariant] = useState<ResumeVariant | null>(null);
  const [tailorError, setTailorError] = useState<ApiError | null>(null);
  const [tailoring, setTailoring] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    setTailorError(null);
    setVariant(null);
    try {
      const [base, applications] = await Promise.all([deps.getBase(), deps.listApplications()]);
      const opportunities = await Promise.all(applications.data.map(async (application) => ({
        applicationId: application.id,
        detail: await deps.getOpportunity(application.opportunityId),
      })));
      setSelectedId(opportunities[0]?.detail.id ?? '');
      setState({ kind: 'ready', base, opportunities });
    } catch (cause) {
      const error = asApiError(cause);
      setState(isInsufficient(error) ? { kind: 'insufficient', error } : { kind: 'error', error });
    }
  }, [deps]);

  useEffect(() => { void load(); }, [load]);

  async function tailor(): Promise<void> {
    if (state.kind !== 'ready' || selectedId.length === 0 || tailoring) return;
    setTailoring(true);
    setTailorError(null);
    setVariant(null);
    try {
      const created = await deps.tailor(state.base.id, { opportunityId: selectedId });
      // Render persisted server truth, not merely the POST response.
      setVariant(await deps.getVariant(created.id));
    } catch (cause) {
      setTailorError(asApiError(cause));
    } finally {
      setTailoring(false);
    }
  }

  if (state.kind === 'loading') return <RouteSkeleton label="Loading your résumé studio …" testId="resume-studio-loading" />;

  if (state.kind === 'insufficient') {
    return (
      <InsufficientData
        heading="Your base résumé needs more profile facts"
        headingLevel={2}
        reason="There is not enough real profile information to build a structured résumé. No placeholder résumé was created."
        next={[
          { id: 'onboarding', label: 'Return to onboarding and import your résumé', href: '/onboarding' },
        ]}
      />
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <ErrorRecoveryRenderer error={state.error} onRetry={() => void load()} />
        <button type="button" onClick={() => void load()} className="self-start rounded-md border border-brand-base px-3 py-1 text-sm text-brand-base focus-visible:ring-2 focus-visible:ring-brand-base">
          Reload résumé studio
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="resume-studio">
      <section aria-labelledby="base-resume-heading" className="rounded-lg border border-border-subtle bg-bg-elevated p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="base-resume-heading" className="text-lg font-semibold text-text-primary">{state.base.name}</h2>
            <p className="mt-1 text-sm text-text-secondary">Structured base résumé — built from your real experience.</p>
          </div>
          <TierBadge tier="green" label="Green · draft only" />
        </div>
        <ol className="mt-4 space-y-3" aria-label="Base résumé facts">
          {[...state.base.selectedItems].sort((a, b) => a.order - b.order).map((item) => (
            <li key={`${item.factId}-${String(item.order)}`} className="rounded-md border border-border-subtle bg-bg-subtle p-3">
              <p className="text-sm text-text-primary">{item.phrasing ?? 'Uses this profile fact without alternate phrasing.'}</p>
              <p className="mt-1 text-xs text-text-muted">Profile fact: {item.factId}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="tailor-heading" className="rounded-lg border border-border-subtle bg-bg-elevated p-5">
        <h2 id="tailor-heading" className="text-lg font-semibold text-text-primary">Tailor a draft</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Choose only from opportunities saved in your pipeline. This is a draft. Nothing was sent or submitted.
        </p>
        {state.opportunities.length === 0 ? (
          <InsufficientData
            className="mt-4"
            heading="No pipeline opportunity to tailor against"
            reason="Tailoring is available only for opportunities you have saved. We will not offer an un-stored job."
            next={[{ id: 'pipeline', label: 'Open your pipeline', href: '/opportunities/pipeline' }, { id: 'browse', label: 'Browse and save opportunities', href: '/opportunities' }]}
          />
        ) : (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-text-primary">
              Pipeline opportunity
              <select
                value={selectedId}
                onChange={(event) => { setSelectedId(event.target.value); setVariant(null); setTailorError(null); }}
                disabled={tailoring}
                className="rounded-md border border-border-subtle bg-bg-subtle px-3 py-2 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base"
              >
                {state.opportunities.map(({ detail }) => (
                  <option key={detail.id} value={detail.id}>{detail.role} · {detail.company}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={tailoring || selectedId.length === 0}
              onClick={() => void tailor()}
              className="rounded-md border border-brand-base bg-brand-base px-4 py-2 text-sm font-semibold text-text-inverse focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-50"
            >
              {tailoring ? 'Tailoring draft …' : 'Tailor résumé draft'}
            </button>
          </div>
        )}
      </section>

      {tailorError ? <TailorRecovery error={tailorError} onRetry={() => void tailor()} onReload={() => void load()} /> : null}
      {variant ? <ResumeVariantView variant={variant} /> : null}
    </div>
  );
}

function TailorRecovery({ error, onRetry, onReload }: { readonly error: ApiError; readonly onRetry: () => void; readonly onReload: () => void }): JSX.Element {
  if (isInsufficient(error)) {
    return <InsufficientData heading="Not enough real experience to tailor" reason="The service could not ground a draft in your profile facts. Nothing was invented." next={[{ id: 'onboarding', label: 'Add real experience through onboarding', href: '/onboarding' }]} />;
  }
  if (isNotOwned(error)) {
    return (
      <section role="alert" data-testid="resume-not-owned-recovery" className="rounded-lg border border-border-subtle bg-bg-subtle p-4 text-sm">
        <h3 className="font-semibold text-text-primary">That opportunity is not in your pipeline</h3>
        <p className="mt-1 text-text-secondary">{error.message} Refresh the studio or choose a saved opportunity.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" onClick={onReload} className="rounded-md border border-brand-base px-3 py-1 text-brand-base focus-visible:ring-2 focus-visible:ring-brand-base">Reload saved opportunities</button>
          <Link href="/opportunities/pipeline" className="rounded-md border border-border-subtle px-3 py-1 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base">Review pipeline</Link>
        </div>
      </section>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ErrorRecoveryRenderer error={error} onRetry={onRetry} />
      {(error.code === 'not_found' || error.code === 'validation_failed') ? (
        <div className="flex flex-wrap gap-3 text-sm">
          <button type="button" onClick={onReload} className="rounded-md border border-brand-base px-3 py-1 text-brand-base focus-visible:ring-2 focus-visible:ring-brand-base">Reload résumé studio</button>
          <Link href="/opportunities/pipeline" className="rounded-md border border-border-subtle px-3 py-1 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base">Choose from pipeline</Link>
        </div>
      ) : null}
    </div>
  );
}

function ResumeVariantView({ variant }: { readonly variant: ResumeVariant }): JSX.Element {
  const hasDiff = variant.diff.selected.length > 0 || variant.diff.dropped.length > 0 || variant.diff.rephrased.length > 0;
  return (
    <article aria-labelledby="variant-heading" data-testid="resume-variant" className="rounded-lg border border-tier-green bg-bg-elevated p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="variant-heading" className="text-lg font-semibold text-text-primary">Tailored résumé draft</h2>
          <p className="mt-1 text-sm text-text-secondary">Built from your real experience. This is a draft. Nothing was sent or submitted.</p>
        </div>
        <TierBadge tier="green" label="Green · advisory draft" />
      </div>

      <section aria-labelledby="tailored-content-heading" className="mt-5">
        <h3 id="tailored-content-heading" className="font-semibold text-text-primary">Tailored content</h3>
        {variant.bullets.length === 0 && variant.rendered.trim().length === 0 ? (
          <InsufficientData className="mt-2" heading="No grounded tailored content returned" reason="The model returned zero bullets grounded in your profile, so CareerOS did not invent any." next={[{ id: 'profile-facts', label: 'Add relevant real experience through onboarding', href: '/onboarding' }]} />
        ) : (
          <div className="mt-2 space-y-3">
            {variant.bullets.length > 0 ? (
              <ul className="ml-5 list-disc space-y-2 text-sm text-text-primary" aria-label="Grounded tailored bullets">
                {variant.bullets.map((bullet) => <li key={`${bullet.factId}-${bullet.text}`}>{bullet.text}<span className="block text-xs text-text-muted">Profile fact: {bullet.factId}</span></li>)}
              </ul>
            ) : null}
            {variant.rendered.trim().length > 0 ? <pre className="whitespace-pre-wrap rounded-md border border-border-subtle bg-bg-subtle p-3 font-sans text-sm text-text-primary">{variant.rendered}</pre> : null}
          </div>
        )}
      </section>

      <section aria-labelledby="diff-heading" className="mt-5 rounded-lg border border-border-subtle bg-bg-subtle p-4">
        <h3 id="diff-heading" className="font-semibold text-text-primary">What changed vs. base</h3>
        {!hasDiff ? (
          <InsufficientData className="mt-2" heading="No changes returned" reason="The tailoring result did not select, drop, or rephrase any profile facts." next={[]} />
        ) : (
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            <DiffList heading="Selected" items={variant.diff.selected} />
            <DiffList heading="Dropped" items={variant.diff.dropped} />
            <section><h4 className="text-sm font-semibold text-text-primary">Rephrased</h4>{variant.diff.rephrased.length > 0 ? <ul className="mt-2 space-y-2 text-xs text-text-secondary">{variant.diff.rephrased.map((item) => <li key={`${item.factId}-${item.to}`}><strong>{item.factId}</strong><span className="block">From: {item.from || '(empty)'}</span><span className="block">To: {item.to || '(empty)'}</span></li>)}</ul> : <p className="mt-2 text-xs text-text-muted">None returned</p>}</section>
          </div>
        )}
      </section>

      <section aria-labelledby="rationale-heading" className="mt-5 rounded-lg border border-border-subtle bg-bg-subtle p-4">
        <h3 id="rationale-heading" className="font-semibold text-text-primary">Rationale</h3>
        {variant.rationale.trim().length > 0 ? <p className="mt-2 text-sm text-text-secondary">{variant.rationale}</p> : <InsufficientData className="mt-2" heading="No rationale returned" reason="The service did not explain a tailoring choice; CareerOS will not make one up." next={[]} />}
      </section>

      <div className="mt-5"><AtsCheckPanel check={variant.atsCheck} /></div>
      <p className="mt-3 text-xs text-text-muted">Model version: {variant.modelVersion}</p>
    </article>
  );
}

function DiffList({ heading, items }: { readonly heading: string; readonly items: readonly string[] }): JSX.Element {
  return <section><h4 className="text-sm font-semibold text-text-primary">{heading}</h4>{items.length > 0 ? <ul className="mt-2 ml-4 list-disc space-y-1 text-xs text-text-secondary">{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="mt-2 text-xs text-text-muted">None returned</p>}</section>;
}