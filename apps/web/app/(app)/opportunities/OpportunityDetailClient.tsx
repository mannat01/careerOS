'use client';

import type { DecisionSupportResponse, OpportunityDetail, OpportunityMatchResponse } from '@careeros/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiClient, ApiError, createApi } from '@/api';
import { ErrorRecoveryRenderer, RouteSkeleton } from '@/shell/state';
import { OpportunityMatchSurface } from './OpportunityMatchSurface';
import { DecisionSupportCard } from './DecisionSupportCard';
import { SourceBadge } from './OpportunitiesClient';

export interface OpportunityDetailDependencies {
  readonly get: (id: string) => Promise<OpportunityDetail>;
  readonly match: (id: string) => Promise<OpportunityMatchResponse>;
  readonly decide: (id: string) => Promise<DecisionSupportResponse>;
}

type DetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly detail: OpportunityDetail; readonly match: OpportunityMatchResponse }
  | { readonly kind: 'error'; readonly error: ApiError };

function productionDependencies(): OpportunityDetailDependencies {
  const api = createApi(apiClient());
  return {
    get: (id) => api.opportunities.get(id),
    match: (id) => api.opportunities.match(id),
    decide: (id) => api.decisions.decide(id),
  };
}

function asApiError(cause: unknown): ApiError {
  return cause instanceof ApiError
    ? cause
    : new ApiError({
        code: 'internal',
        message: cause instanceof Error ? cause.message : 'Opportunity detail request failed.',
      });
}

function compensation(comp: Record<string, unknown> | null): string | null {
  if (!comp) return null;
  const base = comp['base'];
  const band = typeof base === 'object' && base !== null ? base as Record<string, unknown> : comp;
  const min = band['min'];
  const max = band['max'];
  const currency = typeof comp['currency'] === 'string' ? comp['currency'] : 'USD';
  if (typeof min !== 'number' && typeof max !== 'number') return null;
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  if (typeof min === 'number' && typeof max === 'number') return `${formatter.format(min)}–${formatter.format(max)}`;
  return formatter.format(typeof min === 'number' ? min : max as number);
}

export function OpportunityDetailClient({
  opportunityId,
  dependencies,
}: {
  readonly opportunityId: string;
  readonly dependencies?: OpportunityDetailDependencies;
}): JSX.Element {
  const [deps] = useState(() => dependencies ?? productionDependencies());
  const [state, setState] = useState<DetailState>({ kind: 'loading' });
  const [decision, setDecision] = useState<
    | { readonly kind: 'idle' }
    | { readonly kind: 'loading' }
    | { readonly kind: 'ready'; readonly value: DecisionSupportResponse }
    | { readonly kind: 'error'; readonly error: ApiError }
  >({ kind: 'idle' });

  async function load(): Promise<void> {
    setState({ kind: 'loading' });
    try {
      const [detail, match] = await Promise.all([deps.get(opportunityId), deps.match(opportunityId)]);
      setState({ kind: 'ready', detail, match });
    } catch (cause) {
      setState({ kind: 'error', error: asApiError(cause) });
    }
  }

  useEffect(() => {
    void load();
  }, [deps, opportunityId]);

  async function askForDecision(): Promise<void> {
    setDecision({ kind: 'loading' });
    try {
      setDecision({ kind: 'ready', value: await deps.decide(opportunityId) });
    } catch (cause) {
      setDecision({ kind: 'error', error: asApiError(cause) });
    }
  }

  if (state.kind === 'loading') return <RouteSkeleton label="Loading opportunity and why-this-fit evidence…" />;
  if (state.kind === 'error') return <ErrorRecoveryRenderer error={state.error} onRetry={() => void load()} />;

  const { detail, match } = state;
  const comp = compensation(detail.comp);
  return (
    <article aria-labelledby="opportunity-detail-heading" className="space-y-6">
      <Link href="/opportunities" className="inline-flex text-sm font-semibold text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Back to opportunities</Link>
      <header className="rounded-lg border border-border-subtle bg-bg-elevated p-5">
        <div className="flex flex-wrap items-center gap-2"><SourceBadge source={detail.source} />{detail.remote === true ? <span className="text-xs text-text-secondary">Remote</span> : null}</div>
        <h1 id="opportunity-detail-heading" className="mt-2 text-2xl font-semibold text-text-primary">{detail.role}</h1>
        <p className="mt-1 text-text-secondary">{detail.company}{detail.location ? ` · ${detail.location}` : ''}</p>
        {comp ? <p className="mt-2 text-sm text-text-primary">Listed compensation: {comp}</p> : null}
      </header>

      <section aria-labelledby="why-fit-heading" className="space-y-3">
        <div>
          <h2 id="why-fit-heading" className="text-xl font-semibold text-text-primary">Why this fit</h2>
          <p className="text-sm text-text-secondary">Grounded against your profile. Missing demanded skills remain visible as gaps.</p>
        </div>
        <OpportunityMatchSurface match={match} />
      </section>

      <section aria-labelledby="should-apply-heading" className="space-y-3">
        <div>
          <h2 id="should-apply-heading" className="text-xl font-semibold text-text-primary">Should I apply?</h2>
          <p className="text-sm text-text-secondary">Get grounded advice only. This does not apply or submit anything.</p>
        </div>
        <button
          type="button"
          disabled={decision.kind === 'loading'}
          onClick={() => void askForDecision()}
          className="rounded-md bg-brand-base px-4 py-2 text-sm font-semibold text-bg-canvas outline-none focus-visible:ring-2 focus-visible:ring-brand-base disabled:cursor-wait disabled:opacity-60"
        >
          {decision.kind === 'loading' ? 'Considering evidence…' : 'Should I apply?'}
        </button>
        {decision.kind === 'error' ? <ErrorRecoveryRenderer error={decision.error} onRetry={() => void askForDecision()} /> : null}
        {decision.kind === 'ready' ? <DecisionSupportCard decision={decision.value} /> : null}
      </section>

      <section aria-labelledby="posting-heading" className="space-y-3">
        <div>
          <h2 id="posting-heading" className="text-xl font-semibold text-text-primary">Sanitized posting payload</h2>
          <p className="text-sm text-text-secondary">Shown exactly from the API&rsquo;s sanitized raw_payload. Original source text is never re-hydrated.</p>
        </div>
        <pre data-testid="sanitized-raw-payload" className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border-subtle bg-bg-subtle p-4 text-sm text-text-primary">
          {JSON.stringify(detail.rawPayload, null, 2)}
        </pre>
      </section>
    </article>
  );
}
