'use client';

import type {
  Application,
  ApplicationDetail,
  ApplicationListResponse,
  ApplicationPatchRequest,
  ApplicationStatus,
} from '@careeros/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiClient, createApi } from '@/api';
import { buildOptimistic, ErrorRecoveryRenderer, ListSkeleton, runOptimistic } from '@/shell/state';
import { InsufficientData } from '@/trust';
import { AppliedConfirmationDialog } from './AppliedConfirmationDialog';

export const PIPELINE_STAGES: readonly ApplicationStatus[] = [
  'saved', 'drafting', 'ready', 'applied', 'screening', 'interviewing', 'offer', 'closed',
] as const;

const STAGE_LABEL: Record<ApplicationStatus, string> = {
  saved: 'Saved',
  drafting: 'Drafting',
  ready: 'Ready',
  applied: 'Applied',
  screening: 'Screening',
  interviewing: 'Interviewing',
  offer: 'Offer',
  closed: 'Closed',
};

export interface PipelineDependencies {
  readonly list: () => Promise<ApplicationListResponse>;
  readonly patch: (id: string, body: ApplicationPatchRequest) => Promise<ApplicationDetail>;
}

type PipelineState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly applications: readonly Application[] }
  | { readonly kind: 'error'; readonly error: ApiError };

function productionDependencies(): PipelineDependencies {
  const applications = createApi(apiClient()).applications;
  return {
    list: () => applications.list(),
    patch: (id, body) => applications.patch(id, body),
  };
}

function asApiError(cause: unknown): ApiError {
  return cause instanceof ApiError
    ? cause
    : new ApiError({
        code: 'internal',
        message: cause instanceof Error ? cause.message : 'Pipeline request failed.',
      });
}

function nextStage(status: ApplicationStatus): ApplicationStatus | null {
  const index = PIPELINE_STAGES.indexOf(status);
  return index >= 0 ? PIPELINE_STAGES[index + 1] ?? null : null;
}

/** Ordinary controls can never target `applied`; that requires the dialog. */
export function ordinaryMoveTargets(status: ApplicationStatus): readonly ApplicationStatus[] {
  if (status === 'closed') return [];
  const next = nextStage(status);
  const targets: ApplicationStatus[] = [];
  if (next !== null && next !== 'applied') targets.push(next);
  if (next !== 'closed') targets.push('closed');
  return targets;
}

function replaceApplication(
  applications: readonly Application[],
  id: string,
  replacement: Application,
): readonly Application[] {
  return applications.map((application) => application.id === id ? replacement : application);
}

export function PipelineBoardClient({
  dependencies,
}: {
  readonly dependencies?: PipelineDependencies;
}): JSX.Element {
  const [deps] = useState(() => dependencies ?? productionDependencies());
  const [state, setState] = useState<PipelineState>({ kind: 'loading' });
  const [moveError, setMoveError] = useState<ApiError | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [applyCandidate, setApplyCandidate] = useState<Application | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    setMoveError(null);
    try {
      const response = await deps.list();
      setState({ kind: 'ready', applications: response.data });
    } catch (cause) {
      setState({ kind: 'error', error: asApiError(cause) });
    }
  }, [deps]);

  useEffect(() => {
    void load();
  }, [load]);

  async function move(
    application: Application,
    target: ApplicationStatus,
    explicitUserSubmit: boolean,
  ): Promise<void> {
    if (target === 'applied' && !explicitUserSubmit) {
      setMoveError(new ApiError({
        code: 'capability_denied',
        message: 'Applied is only available after the distinct “I applied to this myself” confirmation.',
      }));
      return;
    }
    if (state.kind !== 'ready') return;

    const snapshot = state.applications;
    const optimisticApplication: Application = {
      ...application,
      status: target,
      appliedAt: target === 'applied' ? new Date().toISOString() : application.appliedAt,
      updatedAt: new Date().toISOString(),
    };
    setPendingIds((current) => new Set(current).add(application.id));
    setMoveError(null);

    try {
      await runOptimistic(buildOptimistic({
        snapshot,
        patch: (current) => replaceApplication(current, application.id, optimisticApplication),
        commit: () => deps.patch(application.id, {
          status: target,
          ...(explicitUserSubmit ? { iSubmitted: true } : {}),
        }),
        setState: (applications) => setState({ kind: 'ready', applications }),
        mergeServer: (response, optimistic) => replaceApplication(optimistic, application.id, response),
      }));
      if (target === 'applied') setApplyCandidate(null);
    } catch (cause) {
      setMoveError(asApiError(cause));
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(application.id);
        return next;
      });
    }
  }

  if (state.kind === 'loading') return <ListSkeleton rows={4} label="Loading your application pipeline…" />;
  if (state.kind === 'error') return <ErrorRecoveryRenderer error={state.error} onRetry={() => void load()} />;

  return (
    <section aria-labelledby="pipeline-heading" className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="pipeline-heading" className="text-2xl font-semibold text-text-primary">Application pipeline</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Track your applications. CareerOS never submits or marks an application applied for you.
          </p>
        </div>
        <Link href="/opportunities" className="text-sm font-semibold text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">
          Browse opportunities
        </Link>
      </header>

      {moveError ? (
        <ErrorRecoveryRenderer
          error={moveError}
          onRetry={() => void load()}
          onResolveConflict={() => void load()}
          onRequestApproval={() => setMoveError(null)}
        />
      ) : null}

      {state.applications.length === 0 ? (
        <InsufficientData
          heading="Your pipeline is empty"
          headingLevel={2}
          reason="You have not saved any opportunities yet. CareerOS will not invent an application or mark one applied."
          next={[{ id: 'browse', label: 'Browse opportunities and save one', href: '/opportunities' }]}
        />
      ) : (
        <div
          aria-label="Application pipeline board"
          className="grid gap-4 overflow-x-auto pb-3 sm:grid-cols-2 xl:grid-cols-4"
          data-testid="pipeline-board"
        >
          {PIPELINE_STAGES.map((stage) => {
            const applications = state.applications.filter((application) => application.status === stage);
            return (
              <section
                key={stage}
                aria-labelledby={`pipeline-stage-${stage}`}
                className="min-w-0 rounded-lg border border-border-subtle bg-bg-subtle p-3"
                data-stage={stage}
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 id={`pipeline-stage-${stage}`} className="font-semibold text-text-primary">{STAGE_LABEL[stage]}</h2>
                  <span className="text-xs text-text-muted" aria-label={`${String(applications.length)} applications`}>{applications.length}</span>
                </div>
                {applications.length === 0 ? (
                  <p className="mt-3 text-sm text-text-muted">No applications</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {applications.map((application) => {
                      const pending = pendingIds.has(application.id);
                      const targets = ordinaryMoveTargets(application.status);
                      return (
                        <li key={application.id}>
                          <article
                            aria-labelledby={`application-${application.id}`}
                            className="rounded-md border border-border-subtle bg-bg-elevated p-3"
                            data-testid={`pipeline-card-${application.id}`}
                          >
                            <h3 id={`application-${application.id}`} className="text-sm font-semibold text-text-primary">
                              Opportunity {application.opportunityId}
                            </h3>
                            <Link
                              href={`/opportunities/${encodeURIComponent(application.opportunityId)}`}
                              className="mt-1 inline-flex text-xs text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base"
                            >
                              View opportunity
                            </Link>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {targets.map((target) => (
                                <button
                                  key={target}
                                  type="button"
                                  disabled={pending}
                                  onClick={() => void move(application, target, false)}
                                  className="rounded-md border border-border-subtle px-2 py-1 text-xs font-medium text-text-secondary focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-50"
                                >
                                  Move to {STAGE_LABEL[target]}
                                </button>
                              ))}
                              {application.status === 'ready' ? (
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => setApplyCandidate(application)}
                                  className="rounded-md border border-tier-yellow px-2 py-1 text-xs font-semibold text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-50"
                                >
                                  I applied to this myself
                                </button>
                              ) : null}
                            </div>
                          </article>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {applyCandidate ? (
        <AppliedConfirmationDialog
          opportunityId={applyCandidate.opportunityId}
          busy={pendingIds.has(applyCandidate.id)}
          onCancel={() => setApplyCandidate(null)}
          onConfirm={() => void move(applyCandidate, 'applied', true)}
        />
      ) : null}
    </section>
  );
}