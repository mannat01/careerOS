'use client';

import {
  applicationListResponseSchema,
  interviewPrepRequestSchema,
  interviewPrepResponseSchema,
  opportunityDetailSchema,
  type ApplicationListResponse,
  type InterviewPrepRequest,
  type InterviewPrepResponse,
  type InterviewPracticeQuestion,
  type OpportunityDetail,
} from '@careeros/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiClient, createApi } from '@/api';
import { ErrorRecoveryRenderer, RouteSkeleton } from '@/shell/state';
import { InsufficientData, TierBadge } from '@/trust';

export interface InterviewPrepRoomDependencies {
  readonly listApplications: () => Promise<ApplicationListResponse>;
  readonly getOpportunity: (id: string) => Promise<OpportunityDetail>;
  readonly prepare: (body: InterviewPrepRequest) => Promise<InterviewPrepResponse>;
}

interface PipelineOpportunity {
  readonly applicationId: string;
  readonly detail: OpportunityDetail;
}

type RoomState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: ApiError }
  | { readonly kind: 'ready'; readonly opportunities: readonly PipelineOpportunity[] };

function productionDependencies(): InterviewPrepRoomDependencies {
  const api = createApi(apiClient());
  return {
    listApplications: () => api.applications.list(),
    getOpportunity: (id) => api.opportunities.get(id),
    prepare: (body) => api.interviews.prepare(body),
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

export function InterviewPrepRoomClient({ dependencies }: { readonly dependencies?: InterviewPrepRoomDependencies }): JSX.Element {
  const [deps] = useState(() => dependencies ?? productionDependencies());
  const [state, setState] = useState<RoomState>({ kind: 'loading' });
  const [selectedId, setSelectedId] = useState('');
  const [prep, setPrep] = useState<InterviewPrepResponse | null>(null);
  const [prepareError, setPrepareError] = useState<ApiError | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    setPrepareError(null);
    setPrep(null);
    try {
      const applications = applicationListResponseSchema.parse(await deps.listApplications());
      const opportunities = await Promise.all(applications.data.map(async (application) => ({
        applicationId: application.id,
        detail: opportunityDetailSchema.parse(await deps.getOpportunity(application.opportunityId)),
      })));
      setSelectedId(opportunities[0]?.detail.id ?? '');
      setState({ kind: 'ready', opportunities });
    } catch (cause) {
      setState({ kind: 'error', error: asApiError(cause, 'Interview prep opportunities could not be loaded.') });
    }
  }, [deps]);

  useEffect(() => { void load(); }, [load]);

  async function generate(): Promise<void> {
    if (state.kind !== 'ready' || selectedId.length === 0 || generating) return;
    setGenerating(true);
    setPrepareError(null);
    setPrep(null);
    try {
      const request = interviewPrepRequestSchema.parse({ opportunityId: selectedId });
      const response = interviewPrepResponseSchema.parse(await deps.prepare(request));
      if (response.opportunityId !== selectedId) {
        throw new ApiError({
          code: 'internal',
          message: 'Interview prep was returned for a different opportunity.',
          details: { requestedOpportunityId: selectedId, responseOpportunityId: response.opportunityId },
        });
      }
      setPrep(response);
    } catch (cause) {
      setPrepareError(asApiError(cause, 'Interview practice material could not be generated.'));
    } finally {
      setGenerating(false);
    }
  }

  if (state.kind === 'loading') return <RouteSkeleton label="Loading pipeline opportunities for interview prep …" testId="interview-prep-loading" />;
  if (state.kind === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <ErrorRecoveryRenderer error={state.error} onRetry={() => void load()} />
        <button type="button" onClick={() => void load()} className="self-start rounded-md border border-brand-base px-3 py-1 text-sm text-brand-base focus-visible:ring-2 focus-visible:ring-brand-base">Reload interview prep room</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="interview-prep-room">
      <section aria-labelledby="prep-generator-heading" className="rounded-lg border border-border-subtle bg-bg-elevated p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="prep-generator-heading" className="text-lg font-semibold text-text-primary">Generate grounded practice</h2>
            <p className="mt-1 text-sm text-text-secondary">Choose only from opportunities stored in your pipeline. This is practice. Nothing was sent or submitted.</p>
          </div>
          <TierBadge tier="green" label="Green · practice only" />
        </div>
        {state.opportunities.length === 0 ? (
          <InsufficientData
            className="mt-4"
            heading="No pipeline opportunity to prepare for"
            reason="Interview prep is available only for opportunities you have stored. CareerOS will not offer a role from the global browse list."
            next={[{ id: 'pipeline', label: 'Open your pipeline', href: '/opportunities/pipeline' }, { id: 'browse', label: 'Browse and save an opportunity', href: '/opportunities' }]}
          />
        ) : (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-text-primary">
              Pipeline opportunity
              <select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setPrep(null); setPrepareError(null); }} className="rounded-md border border-border-subtle bg-bg-subtle px-3 py-2 text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base">
                {state.opportunities.map(({ detail }) => <option key={detail.id} value={detail.id}>{detail.role} · {detail.company}</option>)}
              </select>
            </label>
            <button type="button" disabled={generating || selectedId.length === 0} onClick={() => void generate()} className="rounded-md border border-brand-base bg-brand-base px-4 py-2 text-sm font-semibold text-text-inverse focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-50">
              {generating ? 'Generating practice …' : 'Generate practice questions'}
            </button>
          </div>
        )}
      </section>

      {prepareError ? <PrepareRecovery error={prepareError} onRetry={() => void generate()} onReload={() => void load()} /> : null}
      {prep?.status === 'insufficient_data' ? (
        <InsufficientData
          heading="Not enough grounded interview material"
          headingLevel={2}
          reason={`${prep.reason} CareerOS did not invent a question or answer.`}
          next={[{ id: 'profile', label: 'Add relevant real experience through onboarding', href: '/onboarding' }, { id: 'pipeline', label: 'Choose another stored opportunity', href: '/opportunities/pipeline' }]}
        />
      ) : null}
      {prep?.status === 'ready' ? <GroundedPrepView prep={prep} /> : null}
    </div>
  );
}

function PrepareRecovery({ error, onRetry, onReload }: { readonly error: ApiError; readonly onRetry: () => void; readonly onReload: () => void }): JSX.Element {
  if (isNotOwned(error)) {
    return (
      <section role="alert" data-testid="interview-not-owned-recovery" className="rounded-lg border border-border-subtle bg-bg-subtle p-4 text-sm">
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

function GroundedPrepView({ prep }: { readonly prep: Extract<InterviewPrepResponse, { status: 'ready' }> }): JSX.Element {
  return (
    <section aria-labelledby="practice-material-heading" data-testid="grounded-interview-prep" className="rounded-lg border border-tier-green bg-bg-elevated p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="practice-material-heading" className="text-lg font-semibold text-text-primary">Practice material</h2>
          <p className="mt-1 text-sm text-text-secondary">Every question is tied to the stored job description. Suggested framing appears only with real profile evidence.</p>
        </div>
        <TierBadge tier="green" label="Green · no external action" />
      </div>
      <p className="mt-3 text-sm font-medium text-text-primary">This is practice. Nothing was sent or submitted.</p>
      <ol className="mt-5 space-y-5" aria-label="Grounded interview practice questions">
        {prep.questions.map((question, index) => <GroundedQuestion key={question.id} question={question} index={index} modelVersion={prep.modelVersion} />)}
      </ol>
    </section>
  );
}

function GroundedQuestion({ question, index, modelVersion }: { readonly question: InterviewPracticeQuestion; readonly index: number; readonly modelVersion: string }): JSX.Element {
  const hasProfileEvidence = question.suggestedAnswer.evidence.length > 0;
  return (
    <li className="rounded-lg border border-border-subtle bg-bg-subtle p-4" data-testid={`practice-question-${question.id}`}>
      <article aria-labelledby={`practice-question-heading-${question.id}`}>
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Question {String(index + 1)} · {question.kind.replaceAll('_', ' ')}</p>
        <h3 id={`practice-question-heading-${question.id}`} className="mt-1 text-base font-semibold text-text-primary">{question.prompt}</h3>

        <section aria-labelledby={`jd-grounding-${question.id}`} className="mt-4">
          <h4 id={`jd-grounding-${question.id}`} className="text-sm font-semibold text-text-primary">Grounded in this real JD requirement</h4>
          <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-text-secondary">
            {question.grounding.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}
          </ul>
          <p className="mt-2 text-xs text-text-muted">Opportunity provenance: stored opportunity {question.grounding.opportunityId}</p>
        </section>

        {hasProfileEvidence ? (
          <section aria-labelledby={`answer-framing-${question.id}`} className="mt-4 rounded-md border border-border-subtle bg-bg-elevated p-3">
            <h4 id={`answer-framing-${question.id}`} className="text-sm font-semibold text-text-primary">Suggested grounded framing</h4>
            <p className="mt-2 text-sm text-text-secondary">{question.suggestedAnswer.framing}</p>
            <ul className="mt-3 space-y-2" aria-label={`Profile evidence for question ${String(index + 1)}`}>
              {question.suggestedAnswer.evidence.map((evidence) => (
                <li key={`${evidence.factRef}-${evidence.claim}`} className="text-xs text-text-secondary">
                  <span className="font-medium text-text-primary">{evidence.claim}</span>
                  <span className="block">Profile fact provenance: {evidence.factRef}</span>
                </li>
              ))}
            </ul>
            {question.suggestedAnswer.honestGap ? <p className="mt-3 text-xs text-text-secondary">Honest gap strategy: {question.suggestedAnswer.honestGap.note}</p> : null}
          </section>
        ) : (
          <InsufficientData
            className="mt-4"
            heading="No profile-grounded answer framing"
            reason="This question is grounded in the real role, but no real profile fact backs an answer suggestion. CareerOS did not invent one."
            next={[{ id: 'profile', label: 'Add relevant real experience through onboarding', href: '/onboarding' }]}
          />
        )}

        <p className="mt-3 text-xs text-text-muted">Generation provenance: post-guardrail model {modelVersion}</p>
      </article>
    </li>
  );
}