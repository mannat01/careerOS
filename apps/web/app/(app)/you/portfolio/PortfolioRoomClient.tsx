'use client';

import {
  portfolioGenerateResponseSchema,
  portfolioPublishResponseSchema,
  portfolioPublishTokenResponseSchema,
  portfolioResponseSchema,
  publicPortfolioResponseSchema,
  type PortfolioContent,
  type PortfolioGenerateResponse,
  type PortfolioPublishResponse,
  type PortfolioPublishTokenResponse,
  type PortfolioResponse,
  type PublicPortfolioResponse,
  type ReadyPortfolioContent,
} from '@careeros/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiClient, createApi, type ApprovalToken } from '@/api';
import { ErrorRecoveryRenderer, RouteSkeleton } from '@/shell/state';
import { InsufficientData, TierBadge } from '@/trust';

export interface PortfolioRoomDependencies {
  readonly getOwner: () => Promise<PortfolioResponse>;
  readonly generate: () => Promise<PortfolioGenerateResponse>;
  readonly mintPublishToken: () => Promise<PortfolioPublishTokenResponse>;
  readonly publish: (token: ApprovalToken) => Promise<PortfolioPublishResponse>;
  readonly getPublic: (slug: string) => Promise<PublicPortfolioResponse>;
}

type OwnerState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'error'; readonly error: ApiError }
  | { readonly kind: 'ready'; readonly portfolio: PortfolioResponse };

type PublicState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'not_published' }
  | { readonly kind: 'error'; readonly error: ApiError }
  | { readonly kind: 'published'; readonly portfolio: PublicPortfolioResponse };

type MutationFailure = {
  readonly error: ApiError;
  readonly operation: 'generate' | 'mint' | 'publish';
};

function productionDependencies(): PortfolioRoomDependencies {
  const portfolio = createApi(apiClient()).portfolio;
  return {
    getOwner: () => portfolio.getOwner(),
    generate: () => portfolio.generate(),
    mintPublishToken: () => portfolio.mintPublishToken(),
    publish: (token) => portfolio.publish(token),
    getPublic: (slug) => portfolio.getPublic(slug),
  };
}

function asApiError(cause: unknown, fallback: string): ApiError {
  return cause instanceof ApiError ? cause : new ApiError({
    code: 'internal',
    message: cause instanceof Error ? cause.message : fallback,
  });
}

function mismatchReason(error: ApiError): boolean {
  return error.code === 'capability_denied'
    && error.details?.['reason'] === 'approval_payload_mismatch';
}

export function PortfolioRoomClient({ dependencies }: { readonly dependencies?: PortfolioRoomDependencies }): JSX.Element {
  const [deps] = useState(() => dependencies ?? productionDependencies());
  const [owner, setOwner] = useState<OwnerState>({ kind: 'loading' });
  const [mutationError, setMutationError] = useState<MutationFailure | null>(null);
  const [generating, setGenerating] = useState(false);
  const [minting, setMinting] = useState(false);
  const [preview, setPreview] = useState<PortfolioPublishTokenResponse | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [mismatch, setMismatch] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publicState, setPublicState] = useState<PublicState>({ kind: 'idle' });

  const load = useCallback(async (): Promise<void> => {
    setOwner({ kind: 'loading' });
    setMutationError(null);
    try {
      const portfolio = portfolioResponseSchema.parse(await deps.getOwner());
      setOwner({ kind: 'ready', portfolio });
    } catch (cause) {
      const error = asApiError(cause, 'Unable to load your portfolio.');
      setOwner(error.code === 'not_found' ? { kind: 'missing' } : { kind: 'error', error });
    }
  }, [deps]);

  useEffect(() => { void load(); }, [load]);

  async function generate(): Promise<void> {
    setGenerating(true);
    setMutationError(null);
    setMismatch(null);
    setNotice(null);
    setPreview(null);
    setPublicState({ kind: 'idle' });
    try {
      const portfolio = portfolioGenerateResponseSchema.parse(await deps.generate());
      setOwner({ kind: 'ready', portfolio });
    } catch (cause) {
      setMutationError({
        error: asApiError(cause, 'Unable to generate your portfolio.'),
        operation: 'generate',
      });
    } finally {
      setGenerating(false);
    }
  }

  async function mintPreview(): Promise<void> {
    setMinting(true);
    setMutationError(null);
    setMismatch(null);
    setNotice(null);
    setPreview(null);
    try {
      setPreview(portfolioPublishTokenResponseSchema.parse(await deps.mintPublishToken()));
    } catch (cause) {
      setMutationError({
        error: asApiError(cause, 'Unable to prepare the public preview.'),
        operation: 'mint',
      });
    } finally {
      setMinting(false);
    }
  }

  async function confirmPublish(): Promise<void> {
    if (!preview) return;
    const singleUseToken = preview.token;
    setPreview(null);
    setPublishing(true);
    setMutationError(null);
    setMismatch(null);
    setNotice(null);
    try {
      const published = portfolioPublishResponseSchema.parse(await deps.publish(singleUseToken));
      const portfolio = portfolioResponseSchema.parse(published);
      setOwner({ kind: 'ready', portfolio });
      setNotice('Published only after your explicit confirmation.');
      setPublicState({ kind: 'idle' });
    } catch (cause) {
      const error = asApiError(cause, 'Unable to publish your portfolio.');
      if (mismatchReason(error)) {
        setMismatch(error);
        await load();
      } else {
        setMutationError({ error, operation: 'publish' });
      }
    } finally {
      setPublishing(false);
    }
  }

  async function checkPublic(slug: string): Promise<void> {
    setPublicState({ kind: 'loading' });
    try {
      const portfolio = publicPortfolioResponseSchema.parse(await deps.getPublic(slug));
      setPublicState({ kind: 'published', portfolio });
    } catch (cause) {
      const error = asApiError(cause, 'Unable to load the public portfolio.');
      setPublicState(error.code === 'not_found' ? { kind: 'not_published' } : { kind: 'error', error });
    }
  }

  if (owner.kind === 'loading') return <RouteSkeleton label="Loading your portfolio…" testId="portfolio-loading" />;
  if (owner.kind === 'error') return <PortfolioEndpointRecovery error={owner.error} label="Retry owner portfolio" onRecover={() => void load()} />;

  if (owner.kind === 'missing') {
    return (
      <section aria-labelledby="portfolio-start-heading" className="rounded-lg border border-border-subtle bg-bg-elevated p-5">
        <h2 id="portfolio-start-heading" className="text-lg font-semibold text-text-primary">No portfolio draft yet</h2>
        <p className="mt-2 text-sm text-text-secondary">Generate one only from your real profile facts and recorded work. It stays private by default.</p>
        <button type="button" onClick={() => void generate()} disabled={generating} className="mt-4 rounded-md bg-brand-base px-4 py-2 font-semibold text-text-inverse focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-60">
          {generating ? 'Generating…' : 'Generate portfolio'}
        </button>
        {mutationError ? <div className="mt-4"><PortfolioEndpointRecovery error={mutationError.error} label="Retry portfolio generation" onRecover={() => void generate()} /></div> : null}
      </section>
    );
  }

  const portfolio = owner.portfolio;
  const canPublish = portfolio.content.status === 'ready';

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="portfolio-status-heading" className="rounded-lg border border-border-subtle bg-bg-elevated p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="portfolio-status-heading" className="text-lg font-semibold text-text-primary">Owner draft</h2>
            <p className="mt-1 text-sm text-text-secondary">Private editing view · public slug <code>{portfolio.slug}</code></p>
          </div>
          <span className="rounded-full border border-border-subtle px-3 py-1 text-sm font-semibold capitalize">{portfolio.publishStatus}</span>
        </div>

        <div className="mt-5">
          <PortfolioContentView content={portfolio.content} label="Portfolio draft" />
        </div>

        <div className="mt-5 flex flex-wrap gap-3 border-t border-border-subtle pt-4">
          <button type="button" onClick={() => void generate()} disabled={generating || minting || publishing} className="rounded-md border border-brand-base px-4 py-2 font-semibold text-brand-base focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-60">
            {generating ? 'Updating…' : 'Update draft from profile'}
          </button>
          <button type="button" onClick={() => void mintPreview()} disabled={!canPublish || generating || minting || publishing} className="rounded-md border border-tier-yellow bg-tier-yellow px-4 py-2 font-semibold text-text-inverse focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-60">
            {minting ? 'Preparing preview…' : 'Publish'}
          </button>
          <button type="button" onClick={() => void checkPublic(portfolio.slug)} disabled={publicState.kind === 'loading'} className="rounded-md border border-border-subtle px-4 py-2 font-semibold text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-60">
            {publicState.kind === 'loading' ? 'Checking public view…' : 'Check public view'}
          </button>
        </div>
        {!canPublish ? <p className="mt-3 text-sm font-semibold text-text-secondary">Insufficient-data drafts cannot be published.</p> : null}
        {publishing ? <p role="status" className="mt-3 text-sm text-text-secondary">Publishing the confirmed snapshot…</p> : null}
        {notice ? <p role="status" className="mt-3 rounded-md border border-tier-green p-3 text-sm font-semibold text-text-primary">{notice}</p> : null}
        {mismatch ? <MismatchRecovery error={mismatch} onFreshPreview={() => void mintPreview()} /> : null}
        {mutationError ? (
          <div className="mt-4">
            <PortfolioEndpointRecovery
              error={mutationError.error}
              label={mutationError.operation === 'generate' ? 'Retry draft update' : 'Request a fresh public preview'}
              onRecover={() => mutationError.operation === 'generate' ? void generate() : void mintPreview()}
            />
          </div>
        ) : null}
      </section>

      <PublicView state={publicState} onRetry={() => void checkPublic(portfolio.slug)} />

      {preview ? (
        <PublishPreviewDialog
          preview={preview}
          busy={publishing}
          onClose={() => setPreview(null)}
          onConfirm={() => void confirmPublish()}
        />
      ) : null}
    </div>
  );
}

export function PortfolioContentView({ content, label }: { readonly content: PortfolioContent; readonly label: string }): JSX.Element {
  if (content.status === 'insufficient_data') {
    return (
      <InsufficientData
        heading={`${label}: not enough grounded data`}
        headingLevel={2}
        reason={content.reason}
        next={[{ id: 'profile', label: 'Add real projects, skills, or experience to your profile.', href: '/you' }]}
      />
    );
  }

  return <ReadyPortfolioContentView content={content} label={label} />;
}

function ReadyPortfolioContentView({ content, label }: { readonly content: ReadyPortfolioContent; readonly label: string }): JSX.Element {
  return (
    <article aria-label={label} data-testid="grounded-portfolio" className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-text-secondary">Headline</h3>
        <p className="mt-1 text-xl font-semibold text-text-primary">{content.headline.text || 'No grounded headline available.'}</p>
        <FactRefs refs={content.headline.factRefs} label="Headline provenance" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-text-secondary">Summary</h3>
        <p className="mt-1 text-text-primary">{content.summary.text || 'No grounded summary available.'}</p>
        <FactRefs refs={content.summary.factRefs} label="Summary provenance" />
      </div>
      <div>
        <h3 className="font-semibold text-text-primary">Projects</h3>
        {content.projects.length > 0 ? (
          <ul className="mt-3 space-y-3" aria-label={`${label} projects`}>
            {content.projects.map((project) => (
              <li key={`${project.title}-${project.factRefs.join('-')}`} className="rounded-md border border-border-subtle bg-bg-subtle p-4">
                <p className="font-semibold text-text-primary">{project.title}</p>
                <p className="mt-1 text-sm text-text-secondary">{project.description}</p>
                {project.skills.length > 0 ? <p className="mt-2 text-sm text-text-primary">Skills: {project.skills.join(', ')}</p> : null}
                <FactRefs refs={project.factRefs} label={`${project.title} provenance`} />
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-text-secondary">No grounded projects returned.</p>}
      </div>
      <div>
        <h3 className="font-semibold text-text-primary">Skills</h3>
        {content.skills.length > 0 ? (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2" aria-label={`${label} skills`}>
            {content.skills.map((skill) => (
              <li key={`${skill.skill}-${skill.factRefs.join('-')}`} className="rounded-md border border-border-subtle bg-bg-subtle p-3">
                <p className="font-semibold text-text-primary">{skill.skill}</p>
                <FactRefs refs={skill.factRefs} label={`${skill.skill} provenance`} />
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-text-secondary">No grounded skills returned.</p>}
      </div>
      <p className="text-xs text-text-muted">Generation provenance: post-guardrail model {content.modelVersion}</p>
    </article>
  );
}

function FactRefs({ refs, label }: { readonly refs: readonly string[]; readonly label: string }): JSX.Element | null {
  if (refs.length === 0) return null;
  return (
    <div className="mt-2 text-xs text-text-muted">
      <span className="font-semibold">{label}:</span>{' '}
      {refs.map((ref, index) => <span key={ref}><code>{ref}</code>{index < refs.length - 1 ? ', ' : null}</span>)}
    </div>
  );
}

function PublishPreviewDialog({
  preview,
  busy,
  onClose,
  onConfirm,
}: {
  readonly preview: PortfolioPublishTokenResponse;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}): JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !busy) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="portfolio-publish-preview-heading" data-testid="portfolio-publish-preview" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-bg-overlay p-4 pt-12">
      <div className="w-full max-w-3xl rounded-lg border border-border-subtle bg-bg-elevated p-6 shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="portfolio-publish-preview-heading" className="text-xl font-semibold text-text-primary">Here&apos;s exactly what will become public</h2>
            <p className="mt-1 text-sm text-text-secondary">Review the frozen snapshot below. Nothing is public until you explicitly confirm.</p>
          </div>
          <TierBadge tier="yellow" label="Yellow · publish" />
        </div>
        <div className="mt-5 rounded-md border border-tier-yellow p-4">
          <ReadyPortfolioContentView content={preview.content} label="Exact public preview" />
        </div>
        <div className="mt-4 text-xs text-text-muted">
          <p>Public slug: <code>{preview.slug}</code></p>
          <p>Approved payload hash: <code>{preview.payloadHash}</code></p>
          <p>Token expires: <time dateTime={preview.expiresAt}>{preview.expiresAt}</time></p>
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <button ref={closeRef} type="button" onClick={onClose} disabled={busy} className="rounded-md border border-border-subtle px-4 py-2 font-semibold text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-60">Keep private</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="rounded-md border border-tier-yellow bg-tier-yellow px-4 py-2 font-semibold text-text-inverse focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-60">{busy ? 'Publishing…' : 'Confirm publish'}</button>
        </div>
      </div>
    </div>
  );
}

function MismatchRecovery({ error, onFreshPreview }: { readonly error: ApiError; readonly onFreshPreview: () => void }): JSX.Element {
  const rawReason = error.details?.['reason'];
  const reason = typeof rawReason === 'string' ? rawReason : 'approval_payload_mismatch';
  return (
    <section role="alert" data-testid="portfolio-mismatch-recovery" className="mt-4 rounded-md border border-tier-yellow p-4 text-sm text-text-primary">
      <h3 className="font-semibold">The draft changed — confirm it again</h3>
      <p className="mt-1">{reason}. Nothing was published. The stale token was discarded.</p>
      <button type="button" onClick={onFreshPreview} className="mt-3 rounded-md border border-tier-yellow px-3 py-2 font-semibold focus-visible:ring-2 focus-visible:ring-brand-base">Request a fresh public preview</button>
    </section>
  );
}

function PortfolioEndpointRecovery({
  error,
  label,
  onRecover,
}: {
  readonly error: ApiError;
  readonly label: string;
  readonly onRecover: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col items-start gap-2">
      <ErrorRecoveryRenderer
        error={error}
        onRetry={onRecover}
        onRequestApproval={onRecover}
        onResolveConflict={onRecover}
        onReauthenticate={() => { window.location.assign('/sign-in'); }}
      />
      <button type="button" onClick={onRecover} className="rounded-md border border-brand-base px-3 py-1 text-sm font-semibold text-brand-base focus-visible:ring-2 focus-visible:ring-brand-base">{label}</button>
    </div>
  );
}

function PublicView({ state, onRetry }: { readonly state: PublicState; readonly onRetry: () => void }): JSX.Element | null {
  if (state.kind === 'idle') return null;
  if (state.kind === 'loading') return <section aria-label="Public portfolio status"><p role="status" className="text-sm text-text-secondary">Loading only the public endpoint…</p></section>;
  if (state.kind === 'not_published') {
    return (
      <section aria-labelledby="public-portfolio-heading" data-testid="public-not-published" className="rounded-lg border border-border-subtle bg-bg-subtle p-5">
        <h2 id="public-portfolio-heading" className="text-lg font-semibold text-text-primary">Public view: not published</h2>
        <p className="mt-2 text-sm text-text-secondary">The public endpoint returned 404. No owner draft or private profile data is shown here.</p>
      </section>
    );
  }
  if (state.kind === 'error') return <section aria-label="Public portfolio recovery"><PortfolioEndpointRecovery error={state.error} label="Retry public portfolio" onRecover={onRetry} /></section>;
  return (
    <section aria-labelledby="public-portfolio-heading" data-testid="public-portfolio" className="rounded-lg border border-tier-green bg-bg-elevated p-5">
      <h2 id="public-portfolio-heading" className="text-lg font-semibold text-text-primary">Public view: published snapshot</h2>
      <p className="mt-1 text-sm text-text-secondary">Loaded only from GET /v1/portfolio/public/:slug · published <time dateTime={state.portfolio.publishedAt}>{state.portfolio.publishedAt}</time></p>
      <div className="mt-5"><ReadyPortfolioContentView content={state.portfolio.content} label="Published portfolio" /></div>
    </section>
  );
}