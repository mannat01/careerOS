'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import type { ImportedEntity, ProfileImportResponse } from '@careeros/contracts';
import { apiClient, ApiError, createApi } from '@/api';
import { ErrorRecoveryRenderer, RouteSkeleton } from '@/shell/state';
import { InsufficientData, ProvenanceTag } from '@/trust';
import { CareerStateReflectBack } from './CareerStateReflectBack';

export interface OnboardingImportClientProps {
  /** Test seam; production always uses the typed profile domain client. */
  readonly importResume?: (resumeText: string) => Promise<ProfileImportResponse>;
}

type ImportState =
  | { readonly kind: 'input' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'review'; readonly result: ProfileImportResponse }
  | { readonly kind: 'reflect'; readonly result: ProfileImportResponse }
  | { readonly kind: 'error'; readonly error: ApiError };

const GROUPS: ReadonlyArray<{
  readonly kind: ImportedEntity['kind'];
  readonly heading: string;
}> = [
  { kind: 'experience', heading: 'Experience' },
  { kind: 'skill', heading: 'Skills' },
  { kind: 'education', heading: 'Education' },
  { kind: 'project', heading: 'Projects' },
];

function productionImport(resumeText: string): Promise<ProfileImportResponse> {
  return createApi(apiClient()).profile.import({ resumeText });
}

function asApiError(cause: unknown): ApiError {
  return cause instanceof ApiError
    ? cause
    : new ApiError({
        code: 'internal',
        message: cause instanceof Error ? cause.message : 'Résumé import failed.',
      });
}

export function OnboardingImportClient({
  importResume = productionImport,
}: OnboardingImportClientProps): JSX.Element {
  const [resumeText, setResumeText] = useState('');
  const [state, setState] = useState<ImportState>({ kind: 'input' });

  async function submitImport(): Promise<void> {
    const verbatimText = resumeText.trim();
    if (verbatimText.length === 0) return;

    setState({ kind: 'loading' });
    try {
      const result = await importResume(verbatimText);
      setState({ kind: 'review', result });
    } catch (cause) {
      setState({ kind: 'error', error: asApiError(cause) });
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submitImport();
  }

  if (state.kind === 'reflect') {
    return <CareerStateReflectBack importedFacts={state.result.entities} />;
  }

  if (state.kind === 'review') {
    return (
      <ExtractionReview
        result={state.result}
        onBack={() => setState({ kind: 'input' })}
        onReflectBack={() => setState({ kind: 'reflect', result: state.result })}
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-6 px-6 py-12">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-base">
          Onboarding · résumé import
        </p>
        <h1 className="text-3xl font-semibold text-text-primary">Bring in your résumé</h1>
        <p className="max-w-2xl text-text-secondary">
          {"Paste the text from your résumé. We'll extract facts for you to review, and we used only what's in your résumé."}
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label htmlFor="resume-text" className="font-medium text-text-primary">
          Résumé text
        </label>
        <p id="resume-text-help" className="text-sm text-text-secondary">
          Text-first for now. PDF and DOCX file parsing is not available yet.
        </p>
        <textarea
          id="resume-text"
          name="resumeText"
          value={resumeText}
          onChange={(event) => setResumeText(event.target.value)}
          aria-describedby="resume-text-help"
          required
          rows={14}
          disabled={state.kind === 'loading'}
          placeholder="Paste your résumé text here"
          className="w-full resize-y rounded-lg border border-border-subtle bg-bg-elevated p-4 text-text-primary outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-brand-base disabled:cursor-wait disabled:opacity-70"
        />
        <button
          type="submit"
          disabled={resumeText.trim().length === 0 || state.kind === 'loading'}
          className="self-start rounded-md bg-brand-base px-5 py-2.5 text-sm font-medium text-text-inverse outline-none transition-colors duration-fast hover:bg-brand-emphasis focus-visible:ring-2 focus-visible:ring-brand-base focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.kind === 'loading' ? 'Extracting résumé…' : 'Extract résumé'}
        </button>
      </form>

      {state.kind === 'loading' ? (
        <RouteSkeleton label="Extracting only what appears in your résumé…" testId="import-skeleton" />
      ) : null}
      {state.kind === 'error' ? (
        <ErrorRecoveryRenderer error={state.error} onRetry={() => void submitImport()} />
      ) : null}
    </main>
  );
}

export interface ExtractionReviewProps {
  readonly result: ProfileImportResponse;
  readonly onBack?: () => void;
  readonly onReflectBack?: () => void;
}

/** Review-only FM2.1 view. It intentionally performs no completion write. */
export function ExtractionReview({
  result,
  onBack,
  onReflectBack,
}: ExtractionReviewProps): JSX.Element {
  const thin = result.entities.length === 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-base">
          Onboarding · extraction review
        </p>
        <h1 className="text-3xl font-semibold text-text-primary">Review your extracted résumé</h1>
        <p className="max-w-3xl text-text-secondary">
          {"We used only what's in your résumé. Every item below includes the exact source "}
          quote returned by the import API; nothing has been added or inferred.
        </p>
      </header>

      {thin ? (
        <InsufficientData
          heading="Not enough résumé detail yet"
          headingLevel={2}
          reason="The import API did not return any résumé entities, so there is nothing honest to review."
          next={[
            {
              id: 'add-detail',
              label: 'Paste more specific experience, education, project, or skills text.',
            },
          ]}
        />
      ) : (
        <div className="grid gap-8 md:grid-cols-2" data-testid="extraction-groups">
          {GROUPS.map((group) => {
            const entities = result.entities.filter((entity) => entity.kind === group.kind);
            if (entities.length === 0) return null;
            return (
              <section key={group.kind} aria-labelledby={`extraction-${group.kind}`}>
                <h2
                  id={`extraction-${group.kind}`}
                  className="mb-3 text-xl font-semibold text-text-primary"
                >
                  {group.heading}
                </h2>
                <ul className="space-y-3">
                  {entities.map((entity) => (
                    <li
                      key={entity.id}
                      className="rounded-lg border border-border-subtle bg-bg-elevated p-4"
                      data-entity-kind={entity.kind}
                    >
                      <h3 className="font-semibold text-text-primary">{entity.name}</h3>
                      {entity.detail === undefined ? null : (
                        <p className="mt-1 text-sm text-text-secondary">{entity.detail}</p>
                      )}
                      <ProvenanceTag
                        provenance="imported"
                        quote={entity.provenance.quote}
                        className="mt-3 max-w-full"
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <aside className="rounded-lg border border-border-subtle bg-bg-subtle p-4 text-sm text-text-secondary">
        The import response does not include extraction confidence, so this screen does not
        invent or display a confidence score.
      </aside>

      <div className="flex flex-wrap gap-3">
        {onReflectBack === undefined ? null : (
          <button
            type="button"
            onClick={onReflectBack}
            className="rounded-md bg-brand-base px-4 py-2 text-sm font-medium text-text-inverse outline-none focus-visible:ring-2 focus-visible:ring-brand-base"
          >
            Review what CareerOS understands
          </button>
        )}
        {onBack === undefined ? null : (
          <button
            type="button"
            onClick={onBack}
            className="rounded-md border border-border-strong bg-bg-elevated px-4 py-2 text-sm font-medium text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand-base"
          >
            Back to résumé text
          </button>
        )}
      </div>
    </main>
  );
}
