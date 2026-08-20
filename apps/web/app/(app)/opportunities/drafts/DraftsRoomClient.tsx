'use client';

import {
  applicationListResponseSchema,
  draftGenerateRequestSchema,
  draftResponseSchema,
  opportunityDetailSchema,
  type ApplicationListResponse,
  type DraftGenerateRequest,
  type DraftResponse,
  type OpportunityDetail,
} from '@careeros/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiClient, createApi } from '@/api';
import { ErrorRecoveryRenderer, RouteSkeleton } from '@/shell/state';
import { InsufficientData, TierBadge } from '@/trust';

export interface DraftsRoomDependencies {
  readonly listApplications: () => Promise<ApplicationListResponse>;
  readonly getOpportunity: (id: string) => Promise<OpportunityDetail>;
  readonly generate: (body: DraftGenerateRequest) => Promise<DraftResponse>;
  readonly copyText: (text: string) => Promise<void>;
}

interface PipelineOpportunity {
  readonly applicationId: string;
  readonly detail: OpportunityDetail;
}

type RoomState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: ApiError }
  | { readonly kind: 'ready'; readonly opportunities: readonly PipelineOpportunity[] };

function productionDependencies(): DraftsRoomDependencies {
  const api = createApi(apiClient());
  return {
    listApplications: () => api.applications.list(),
    getOpportunity: (id) => api.opportunities.get(id),
    generate: (body) => api.drafts.generate(body),
    copyText: (text) => navigator.clipboard.writeText(text),
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

function optionalValue(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function DraftsRoomClient({ dependencies }: { readonly dependencies?: DraftsRoomDependencies }): JSX.Element {
  const [deps] = useState(() => dependencies ?? productionDependencies());
  const [state, setState] = useState<RoomState>({ kind: 'loading' });
  const [selectedId, setSelectedId] = useState('');
  const [kind, setKind] = useState<DraftGenerateRequest['kind']>('cover_letter');
  const [recipientName, setRecipientName] = useState('');
  const [recipientRole, setRecipientRole] = useState('');
  const [recipientChannel, setRecipientChannel] = useState('');
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [generateError, setGenerateError] = useState<ApiError | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    setGenerateError(null);
    setDraft(null);
    setCopyState('idle');
    try {
      const applications = applicationListResponseSchema.parse(await deps.listApplications());
      const opportunities = await Promise.all(applications.data.map(async (application) => ({
        applicationId: application.id,
        detail: opportunityDetailSchema.parse(await deps.getOpportunity(application.opportunityId)),
      })));
      setSelectedId(opportunities[0]?.detail.id ?? '');
      setState({ kind: 'ready', opportunities });
    } catch (cause) {
      setState({ kind: 'error', error: asApiError(cause, 'Pipeline opportunities for drafts could not be loaded.') });
    }
  }, [deps]);

  useEffect(() => { void load(); }, [load]);

  async function generate(): Promise<void> {
    if (state.kind !== 'ready' || selectedId.length === 0 || generating) return;
    setGenerating(true);
    setGenerateError(null);
    setDraft(null);
    setCopyState('idle');
    try {
      const recipient = kind === 'outreach' ? {
        name: optionalValue(recipientName),
        role: optionalValue(recipientRole),
        channel: optionalValue(recipientChannel),
      } : undefined;
      const hasRecipient = recipient && Object.values(recipient).some((value) => value !== undefined);
      const request = draftGenerateRequestSchema.parse({
        kind,
        opportunityId: selectedId,
        ...(hasRecipient ? { recipient } : {}),
      });
      const response = draftResponseSchema.parse(await deps.generate(request));
      if (response.status === 'draft' && response.opportunityId !== selectedId) {
        throw new ApiError({
          code: 'internal',
          message: 'The draft was returned for a different opportunity.',
          details: { requestedOpportunityId: selectedId, responseOpportunityId: response.opportunityId },
        });
      }
      setDraft(response);
    } catch (cause) {
      setGenerateError(asApiError(cause, 'The draft could not be generated.'));
    } finally {
      setGenerating(false);
    }
  }

  async function copyDraft(value: Extract<DraftResponse, { status: 'draft' }>): Promise<void> {
    try {
      await deps.copyText(`${value.subject}\n\n${value.body}`);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }

  if (state.kind === 'loading') return <RouteSkeleton label="Loading pipeline opportunities for drafts …" testId="drafts-loading" />;
  if (state.kind === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <ErrorRecoveryRenderer error={state.error} onRetry={() => void load()} />
        <button type="button" onClick={() => void load()} className="self-start rounded-md border border-brand-base px-3 py-1 text-sm text-brand-base focus-visible:ring-2 focus-visible:ring-brand-base">Reload Drafts room</button>
      </div>
    );
  }

  const selectedOpportunity = state.opportunities.find(({ detail }) => detail.id === selectedId)?.detail;

  return (
    <div className="flex flex-col gap-6" data-testid="drafts-room">
      <section aria-labelledby="draft-generator-heading" className="rounded-lg border border-border-subtle bg-bg-elevated p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="draft-generator-heading" className="text-lg font-semibold text-text-primary">Generate a grounded draft</h2>
            <p className="mt-1 text-sm text-text-secondary">Choose only from opportunities stored in your pipeline. This is a draft. Nothing was sent or submitted.</p>
          </div>
          <TierBadge tier="green" label="Green · draft only" />
        </div>

        {state.opportunities.length === 0 ? (
          <InsufficientData
            className="mt-4"
            heading="No pipeline opportunity to draft for"
            reason="Drafts are available only for opportunities you have stored. CareerOS will not offer a role from the global browse list."
            next={[{ id: 'pipeline', label: 'Open your pipeline', href: '/opportunities/pipeline' }, { id: 'browse', label: 'Browse and save an opportunity', href: '/opportunities' }]}
          />
        ) : (
          <div className="mt-5 space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium text-text-primary">
                Draft kind
                <select value={kind} onChange={(event) => { setKind(event.target.value as DraftGenerateRequest['kind']); setDraft(null); setGenerateError(null); setCopyState('idle'); }} className="rounded-md border border-border-subtle bg-bg-subtle px-3 py-2 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base">
                  <option value="cover_letter">Cover letter</option>
                  <option value="outreach">Outreach message</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-text-primary">
                Pipeline opportunity
                <select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setDraft(null); setGenerateError(null); setCopyState('idle'); }} className="rounded-md border border-border-subtle bg-bg-subtle px-3 py-2 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base">
                  {state.opportunities.map(({ detail }) => <option key={detail.id} value={detail.id}>{detail.role} · {detail.company}</option>)}
                </select>
              </label>
            </div>

            {kind === 'outreach' ? (
              <fieldset className="rounded-md border border-border-subtle p-4">
                <legend className="px-1 text-sm font-semibold text-text-primary">Optional recipient</legend>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="flex flex-col gap-1 text-sm text-text-secondary">Name<input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} className="rounded-md border border-border-subtle bg-bg-subtle px-3 py-2 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base" /></label>
                  <label className="flex flex-col gap-1 text-sm text-text-secondary">Role<input value={recipientRole} onChange={(event) => setRecipientRole(event.target.value)} className="rounded-md border border-border-subtle bg-bg-subtle px-3 py-2 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base" /></label>
                  <label className="flex flex-col gap-1 text-sm text-text-secondary">Channel<input value={recipientChannel} onChange={(event) => setRecipientChannel(event.target.value)} className="rounded-md border border-border-subtle bg-bg-subtle px-3 py-2 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base" /></label>
                </div>
              </fieldset>
            ) : null}

            <button type="button" disabled={generating || selectedId.length === 0} onClick={() => void generate()} className="rounded-md border border-brand-base bg-brand-base px-4 py-2 font-semibold text-white focus-visible:ring-2 focus-visible:ring-brand-base disabled:cursor-not-allowed disabled:opacity-60">
              {generating ? 'Generating grounded draft…' : 'Generate draft'}
            </button>
          </div>
        )}
      </section>

      {generateError ? <DraftRecovery error={generateError} onRetry={() => void generate()} onReload={() => void load()} /> : null}
      {draft?.status === 'insufficient_data' ? (
        <InsufficientData
          heading="Not enough grounded evidence for a draft"
          reason="No profile-backed claim survived the drafting guardrail, so CareerOS returned no subject or message text."
          next={[{ id: 'profile', label: 'Add relevant real experience through onboarding', href: '/onboarding' }, { id: 'pipeline', label: 'Choose another stored opportunity', href: '/opportunities/pipeline' }]}
        />
      ) : null}
      {draft?.status === 'draft' && selectedOpportunity ? (
        <GroundedDraftView draft={draft} opportunity={selectedOpportunity} copyState={copyState} onCopy={() => void copyDraft(draft)} />
      ) : null}
    </div>
  );
}

function DraftRecovery({ error, onRetry, onReload }: { readonly error: ApiError; readonly onRetry: () => void; readonly onReload: () => void }): JSX.Element {
  if (isNotOwned(error)) {
    return (
      <section role="alert" data-testid="draft-not-owned-recovery" className="rounded-lg border border-border-subtle bg-bg-subtle p-4 text-sm">
        <h2 className="font-semibold text-text-primary">That opportunity is not in your pipeline</h2>
        <p className="mt-1 text-text-secondary">{error.message} Reload the caller-scoped list or review your pipeline.</p>
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
          <button type="button" onClick={onReload} className="rounded-md border border-brand-base px-3 py-1 text-brand-base focus-visible:ring-2 focus-visible:ring-brand-base">Reload pipeline opportunities</button>
          <Link href="/opportunities/pipeline" className="rounded-md border border-border-subtle px-3 py-1 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base">Choose from pipeline</Link>
        </div>
      ) : null}
    </div>
  );
}

function GroundedDraftView({
  draft,
  opportunity,
  copyState,
  onCopy,
}: {
  readonly draft: Extract<DraftResponse, { status: 'draft' }>;
  readonly opportunity: OpportunityDetail;
  readonly copyState: 'idle' | 'copied' | 'error';
  readonly onCopy: () => void;
}): JSX.Element {
  return (
    <article aria-labelledby="generated-draft-heading" data-testid="grounded-draft" className="rounded-lg border border-tier-green bg-bg-elevated p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="generated-draft-heading" className="text-lg font-semibold text-text-primary">Generated draft</h2>
          <p className="mt-1 text-sm text-text-secondary">Opportunity provenance: {opportunity.role} at {opportunity.company} · stored opportunity {opportunity.id}</p>
        </div>
        <TierBadge tier="green" label="Green · draft only" />
      </div>

      <p className="mt-4 font-semibold text-text-primary">This is a draft. Nothing was sent or submitted.</p>
      <section aria-labelledby="draft-subject-heading" className="mt-5">
        <h3 id="draft-subject-heading" className="text-sm font-semibold text-text-primary">Subject</h3>
        <p className="mt-1 text-text-primary">{draft.subject}</p>
      </section>
      <section aria-labelledby="draft-body-heading" className="mt-4">
        <h3 id="draft-body-heading" className="text-sm font-semibold text-text-primary">Body</h3>
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border-subtle bg-bg-subtle p-4 font-sans text-sm text-text-primary">{draft.body}</pre>
      </section>
      <section aria-labelledby="draft-grounding-heading" className="mt-5 rounded-md border border-border-subtle bg-bg-subtle p-4">
        <h3 id="draft-grounding-heading" className="font-semibold text-text-primary">Claims and grounding</h3>
        <p className="mt-1 text-sm text-text-secondary">Every factual claim below is backed by a real profile fact or evidence reference.</p>
        <ul className="mt-3 space-y-3" aria-label="Evidence backing this draft">
          {draft.claims.map((claim) => (
            <li key={`${claim.factRef}-${claim.claim}`} className="text-sm text-text-secondary">
              <span className="font-medium text-text-primary">{claim.claim}</span>
              <span className="block text-xs">Evidence provenance: {claim.factRef}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="mt-4 text-xs text-text-muted">Generation provenance: post-guardrail model {draft.modelVersion}</p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onCopy} className="rounded-md border border-brand-base px-4 py-2 font-semibold text-brand-base focus-visible:ring-2 focus-visible:ring-brand-base">Copy draft to clipboard</button>
        <p role="status" className="text-sm text-text-secondary">
          {copyState === 'copied' ? 'Draft copied. Nothing was sent or submitted.' : null}
          {copyState === 'error' ? 'Copy failed. Select the draft text and copy it manually.' : null}
        </p>
      </div>
    </article>
  );
}