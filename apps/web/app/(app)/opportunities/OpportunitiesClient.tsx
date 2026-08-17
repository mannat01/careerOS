'use client';

import type {
  OpportunityListItem,
  OpportunityListResponse,
  OpportunityMatchResponse,
} from '@careeros/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiClient, ApiError, createApi, type OpportunitiesListQuery } from '@/api';
import { ErrorRecoveryRenderer, ListSkeleton } from '@/shell/state';
import { InsufficientData } from '@/trust';
import { OpportunityMatchSurface } from './OpportunityMatchSurface';

export interface OpportunityBrowseDependencies {
  readonly list: (query: OpportunitiesListQuery) => Promise<OpportunityListResponse>;
  readonly match: (id: string) => Promise<OpportunityMatchResponse>;
}

export interface OpportunityFilters {
  readonly source?: string;
  readonly remote?: boolean;
  readonly comp?: boolean;
  readonly freshness?: number;
}

interface LoadedPage {
  readonly opportunities: readonly OpportunityListItem[];
  readonly matches: Readonly<Record<string, OpportunityMatchResponse>>;
  readonly nextCursor: string | null;
}

type BrowseState =
  | { readonly kind: 'loading' }
  | ({ readonly kind: 'ready' } & LoadedPage)
  | { readonly kind: 'error'; readonly error: ApiError };

function productionDependencies(): OpportunityBrowseDependencies {
  const opportunities = createApi(apiClient()).opportunities;
  return {
    list: (query) => opportunities.list(query),
    match: (id) => opportunities.match(id),
  };
}

function asApiError(cause: unknown): ApiError {
  return cause instanceof ApiError
    ? cause
    : new ApiError({
        code: 'internal',
        message: cause instanceof Error ? cause.message : 'Opportunities request failed.',
      });
}

async function loadPage(
  deps: OpportunityBrowseDependencies,
  filters: OpportunityFilters,
  cursor?: string,
): Promise<LoadedPage> {
  const page = await deps.list({ ...filters, ...(cursor ? { cursor } : {}), limit: 10 });
  const matchEntries = await Promise.all(
    page.data.map(async (opportunity) => [opportunity.id, await deps.match(opportunity.id)] as const),
  );
  return {
    opportunities: page.data,
    matches: Object.fromEntries(matchEntries),
    nextCursor: page.nextCursor,
  };
}

export function SourceBadge({ source }: { readonly source: string }): JSX.Element {
  return (
    <span className="inline-flex rounded-full border border-border-subtle bg-bg-subtle px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-text-secondary">
      {source}
    </span>
  );
}

export function OpportunitiesClient({
  dependencies,
}: {
  readonly dependencies?: OpportunityBrowseDependencies;
}): JSX.Element {
  const [deps] = useState(() => dependencies ?? productionDependencies());
  const [filters, setFilters] = useState<OpportunityFilters>({});
  const [draft, setDraft] = useState({ source: '', remote: '', comp: '', freshness: '' });
  const [state, setState] = useState<BrowseState>({ kind: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);

  async function load(nextFilters: OpportunityFilters = filters): Promise<void> {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', ...(await loadPage(deps, nextFilters)) });
    } catch (cause) {
      setState({ kind: 'error', error: asApiError(cause) });
    }
  }

  useEffect(() => {
    void load({});
  }, [deps]);

  function applyFilters(): void {
    const next: OpportunityFilters = {
      ...(draft.source ? { source: draft.source } : {}),
      ...(draft.remote ? { remote: draft.remote === 'true' } : {}),
      ...(draft.comp === 'true' ? { comp: true } : {}),
      ...(draft.freshness ? { freshness: Number(draft.freshness) } : {}),
    };
    setFilters(next);
    void load(next);
  }

  function clearFilters(): void {
    setDraft({ source: '', remote: '', comp: '', freshness: '' });
    setFilters({});
    void load({});
  }

  async function loadMore(): Promise<void> {
    if (state.kind !== 'ready' || !state.nextCursor) return;
    setLoadingMore(true);
    try {
      const next = await loadPage(deps, filters, state.nextCursor);
      setState({
        kind: 'ready',
        opportunities: [...state.opportunities, ...next.opportunities],
        matches: { ...state.matches, ...next.matches },
        nextCursor: next.nextCursor,
      });
    } catch (cause) {
      setState({ kind: 'error', error: asApiError(cause) });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section aria-labelledby="opportunities-heading" className="flex flex-col gap-6">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 id="opportunities-heading" className="text-2xl font-semibold text-text-primary">Opportunities</h1>
            <p className="mt-1 text-text-secondary">Browse roles from sanctioned sources, with grounded match explanations.</p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm font-semibold">
            <Link href="/opportunities/interview-prep" className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Open interview prep</Link>
            <Link href="/opportunities/pipeline" className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">View application pipeline</Link>
          </div>
        </div>
      </header>

      <form
        aria-label="Filter opportunities"
        className="grid gap-3 rounded-lg border border-border-subtle bg-bg-elevated p-4 md:grid-cols-4"
        onSubmit={(event) => { event.preventDefault(); applyFilters(); }}
      >
        <label className="grid gap-1 text-sm text-text-secondary">
          Source
          <select value={draft.source} onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))} className="rounded-md border border-border-subtle bg-bg-base p-2 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base">
            <option value="">All sources</option>
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
            <option value="usajobs">USAJobs</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm text-text-secondary">
          Work location
          <select value={draft.remote} onChange={(event) => setDraft((current) => ({ ...current, remote: event.target.value }))} className="rounded-md border border-border-subtle bg-bg-base p-2 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base">
            <option value="">Remote or on-site</option>
            <option value="true">Remote</option>
            <option value="false">On-site</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm text-text-secondary">
          Compensation
          <select value={draft.comp} onChange={(event) => setDraft((current) => ({ ...current, comp: event.target.value }))} className="rounded-md border border-border-subtle bg-bg-base p-2 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base">
            <option value="">Listed or unlisted</option>
            <option value="true">Compensation listed</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm text-text-secondary">
          Freshness
          <select value={draft.freshness} onChange={(event) => setDraft((current) => ({ ...current, freshness: event.target.value }))} className="rounded-md border border-border-subtle bg-bg-base p-2 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base">
            <option value="">Any time</option>
            <option value="1">Past 24 hours</option>
            <option value="7">Past 7 days</option>
            <option value="30">Past 30 days</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-2 md:col-span-4">
          <button type="submit" className="rounded-md bg-brand-base px-4 py-2 text-sm font-semibold text-bg-base focus-visible:ring-2 focus-visible:ring-brand-base focus-visible:ring-offset-2">Apply filters</button>
          <button type="button" onClick={clearFilters} className="rounded-md border border-border-subtle px-4 py-2 text-sm text-text-secondary focus-visible:ring-2 focus-visible:ring-brand-base">Clear filters</button>
        </div>
      </form>

      {state.kind === 'loading' ? <ListSkeleton rows={3} label="Loading opportunities and match explanations…" /> : null}
      {state.kind === 'error' ? <ErrorRecoveryRenderer error={state.error} onRetry={() => void load()} /> : null}
      {state.kind === 'ready' && state.opportunities.length === 0 ? (
        <InsufficientData
          heading="No opportunities found"
          headingLevel={2}
          reason="No roles match these filters right now. CareerOS will not invent a role to fill the list."
          next={[
            { id: 'filters', label: 'Clear or broaden the filters' },
            { id: 'later', label: 'Check again after new sanctioned-source ingestion' },
          ]}
        />
      ) : null}
      {state.kind === 'ready' && state.opportunities.length > 0 ? (
        <>
          <ul className="grid gap-4" aria-label="Opportunity results">
            {state.opportunities.map((opportunity) => {
              const match = state.matches[opportunity.id];
              return (
                <li key={opportunity.id} className="rounded-lg border border-border-subtle bg-bg-elevated p-5">
                  <article aria-labelledby={`opportunity-${opportunity.id}`} className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><SourceBadge source={opportunity.source} />{opportunity.remote === true ? <span className="text-xs text-text-secondary">Remote</span> : null}</div>
                      <h2 id={`opportunity-${opportunity.id}`} className="mt-2 text-lg font-semibold text-text-primary">{opportunity.role}</h2>
                      <p className="text-text-secondary">{opportunity.company}{opportunity.location ? ` · ${opportunity.location}` : ''}</p>
                      <Link href={`/opportunities/${encodeURIComponent(opportunity.id)}`} className="mt-3 inline-flex text-sm font-semibold text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">View role and why this fit</Link>
                    </div>
                    {match ? <OpportunityMatchSurface match={match} compact /> : null}
                  </article>
                </li>
              );
            })}
          </ul>
          {state.nextCursor ? (
            <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="self-center rounded-md border border-brand-base px-4 py-2 text-sm font-semibold text-brand-base disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-brand-base">
              {loadingMore ? 'Loading more…' : 'Load more opportunities'}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
