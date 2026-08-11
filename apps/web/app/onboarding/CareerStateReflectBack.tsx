'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type {
  CieDimensionKey,
  CieStateDimension,
  CieStateExplainResponse,
  CieStateResponse,
  EditedProfileFact,
  ImportedEntity,
  ProfileFactEditRequest,
  ProfileFactEditResponse,
} from '@careeros/contracts';
import { apiClient, ApiError, createApi } from '@/api';
import { ErrorRecoveryRenderer, RouteSkeleton } from '@/shell/state';
import {
  AiSurface,
  ConfidenceChip,
  InsufficientData,
  ProvenanceTag,
  WhyPopover,
  bandFor,
  type Confidence,
  type Evidence,
  type Provenance,
} from '@/trust';

export interface CareerStateDependencies {
  readonly getState: () => Promise<CieStateResponse>;
  readonly explain: (dimension: CieDimensionKey) => Promise<CieStateExplainResponse>;
  readonly editFact: (
    factId: string,
    body: ProfileFactEditRequest,
  ) => Promise<ProfileFactEditResponse>;
  readonly recompute: (change?: {
    readonly factId: string;
    readonly reason: string;
  }) => Promise<CieStateResponse>;
}

function productionDependencies(): CareerStateDependencies {
  const api = createApi(apiClient());
  return {
    getState: () => api.cieState.get(),
    explain: (dimension) => api.cieState.explain(dimension),
    editFact: (factId, body) => api.profile.editFact(factId, body),
    recompute: (change) => api.cieState.recompute(change),
  };
}

type Explanations = Readonly<Partial<Record<CieDimensionKey, CieStateExplainResponse>>>;
type CorrectionContext = CieDimensionKey | 'profile_fact';
type LoadState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly model: CieStateResponse;
      readonly explanations: Explanations;
    }
  | { readonly kind: 'error'; readonly error: ApiError };

function asApiError(cause: unknown): ApiError {
  return cause instanceof ApiError
    ? cause
    : new ApiError({
        code: 'internal',
        message: cause instanceof Error ? cause.message : 'Career state request failed.',
      });
}

async function explanationsFor(
  model: CieStateResponse,
  deps: CareerStateDependencies,
): Promise<Explanations> {
  const entries = await Promise.all(
    model.dimensions.map(async (dimension) =>
      [dimension.dimension, await deps.explain(dimension.dimension)] as const,
    ),
  );
  return Object.fromEntries(entries);
}

export function CareerStateReflectBack({
  dependencies,
  importedFacts = [],
}: {
  readonly dependencies?: CareerStateDependencies;
  readonly importedFacts?: readonly ImportedEntity[];
}): JSX.Element {
  const [deps] = useState<CareerStateDependencies>(() => dependencies ?? productionDependencies());
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [corrections, setCorrections] = useState<readonly EditedProfileFact[]>([]);
  const [mutationError, setMutationError] = useState<ApiError | null>(null);

  async function load(): Promise<void> {
    setLoadState({ kind: 'loading' });
    try {
      let model: CieStateResponse;
      try {
        model = await deps.getState();
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.code !== 'not_found') throw cause;
        await deps.recompute();
        model = await deps.getState();
      }
      setLoadState({ kind: 'ready', model, explanations: await explanationsFor(model, deps) });
    } catch (cause) {
      setLoadState({ kind: 'error', error: asApiError(cause) });
    }
  }

  useEffect(() => {
    void load();
  }, [deps]);

  async function correctFact(
    dimension: CorrectionContext,
    source: EditableEvidence,
    label: string,
  ): Promise<boolean> {
    setMutationError(null);
    try {
      const edited = await deps.editFact(source.id, { kind: source.kind, label });
      setCorrections((current) => [
        ...current.filter((fact) => fact.id !== edited.fact.id),
        edited.fact,
      ]);
      const model = await deps.recompute({
        factId: source.ref,
        reason: dimension === 'profile_fact'
          ? `User corrected ${source.kind} profile fact`
          : `User corrected ${dimension}`,
      });
      setLoadState({ kind: 'ready', model, explanations: await explanationsFor(model, deps) });
      return true;
    } catch (cause) {
      setMutationError(asApiError(cause));
      return false;
    }
  }

  if (loadState.kind === 'loading') {
    return (
      <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12">
        <RouteSkeleton label="Loading what CareerOS understands about you…" />
      </main>
    );
  }
  if (loadState.kind === 'error') {
    return (
      <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12">
        <ErrorRecoveryRenderer error={loadState.error} onRetry={() => void load()} />
      </main>
    );
  }

  return (
    <CareerStateReview
      model={loadState.model}
      explanations={loadState.explanations}
      corrections={corrections}
      importedFacts={importedFacts}
      mutationError={mutationError}
      onCorrect={correctFact}
    />
  );
}

export interface CareerStateReviewProps {
  readonly model: CieStateResponse;
  readonly explanations: Explanations;
  readonly corrections?: readonly EditedProfileFact[];
  readonly importedFacts?: readonly ImportedEntity[];
  readonly mutationError?: ApiError | null;
  readonly onCorrect?: (
    dimension: CorrectionContext,
    source: EditableEvidence,
    label: string,
  ) => Promise<boolean>;
}

export function CareerStateReview({
  model,
  explanations,
  corrections = [],
  importedFacts = [],
  mutationError = null,
  onCorrect,
}: CareerStateReviewProps): JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-base">
          Onboarding · reflect back
        </p>
        <h1 className="text-3xl font-semibold text-text-primary">
          What CareerOS understands about you
        </h1>
        <p className="max-w-3xl text-text-secondary">
          Read the evidence, confidence, and provenance behind each dimension. Correct a
          source fact whenever we misunderstood it.
        </p>
      </header>

      {corrections.length > 0 ? (
        <section
          aria-labelledby="corrections-heading"
          className="rounded-lg border border-brand-base bg-bg-elevated p-4"
          data-testid="authoritative-corrections"
        >
          <h2 id="corrections-heading" className="text-lg font-semibold text-text-primary">
            Your corrections
          </h2>
          <ul className="mt-3 space-y-2">
            {corrections.map((fact) => (
              <li key={fact.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-text-primary">{fact.label}</span>
                <ProvenanceTag provenance="user" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {mutationError ? <ErrorRecoveryRenderer error={mutationError} /> : null}

      <div className="grid gap-5 md:grid-cols-2" data-testid="career-state-dimensions">
        {model.dimensions.map((dimension) => (
          <DimensionCard
            key={dimension.dimension}
            dimension={dimension}
            explanation={explanations[dimension.dimension]}
            corrections={corrections}
            onCorrect={onCorrect}
          />
        ))}
      </div>

      {importedFacts.length > 0 && onCorrect ? (
        <SourceFactCorrections
          facts={importedFacts}
          corrections={corrections}
          onCorrect={onCorrect}
        />
      ) : null}

      <p className="text-xs text-text-muted">
        State model version {model.version}. This step does not complete onboarding or change
        autonomy settings.
      </p>
    </main>
  );
}

function SourceFactCorrections({
  facts,
  corrections,
  onCorrect,
}: {
  readonly facts: readonly ImportedEntity[];
  readonly corrections: readonly EditedProfileFact[];
  readonly onCorrect: NonNullable<CareerStateReviewProps['onCorrect']>;
}): JSX.Element {
  return (
    <section
      aria-labelledby="source-facts-heading"
      className="rounded-lg border border-border-subtle bg-bg-elevated p-4"
    >
      <h2 id="source-facts-heading" className="text-lg font-semibold text-text-primary">
        Profile facts behind this model
      </h2>
      <p className="mt-1 text-sm text-text-secondary">
        Correct an imported fact directly. Your correction becomes authoritative before the
        model recomputes.
      </p>
      <div className="mt-4 space-y-3">
        {facts.map((fact) => {
          const correction = corrections.find((candidate) => candidate.id === fact.id);
          const source: EditableEvidence = {
            ref: `${fact.kind}:${fact.id}`,
            id: fact.id,
            kind: fact.kind,
            label: correction?.label ?? fact.name,
          };
          return (
            <div key={fact.id} className="rounded-md border border-border-subtle p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-medium text-text-primary">{source.label}</span>
                <ProvenanceTag
                  provenance={correction ? 'user' : 'imported'}
                  {...(correction ? {} : { quote: fact.provenance.quote })}
                />
              </div>
              <CorrectionForm
                dimension="profile_fact"
                source={source}
                onCorrect={onCorrect}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DimensionCard({
  dimension,
  explanation,
  corrections,
  onCorrect,
}: {
  readonly dimension: CieStateDimension;
  readonly explanation?: CieStateExplainResponse;
  readonly corrections: readonly EditedProfileFact[];
  readonly onCorrect?: CareerStateReviewProps['onCorrect'];
}): JSX.Element {
  const label = dimensionLabel(dimension.dimension);
  const confidence = confidenceFor(dimension);
  const evidence = evidenceFor(explanation);
  const noSignal =
    dimension.provenance === 'no-signal' || dimension.value.values.length === 0;
  const correctedSource = corrections.find((fact) =>
    explanation?.evidence.some((source) => source.ref.endsWith(`:${fact.id}`)),
  );
  const body = (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold text-text-primary">{label}</h2>
        <ConfidenceChip confidence={confidence} showValue={!noSignal} />
        <ProvenanceTag provenance={stateProvenance(dimension.provenance)} />
        <WhyPopover
          subject={{ kind: 'career-state', label }}
          evidence={evidence}
          reasoning={
            explanation?.reasoning ??
            'The explanation endpoint did not return reasoning for this dimension.'
          }
        />
      </div>

      {skillFraming(dimension.dimension)}

      {noSignal ? (
        <InsufficientData
          reason={`Your current profile does not provide enough evidence for ${label.toLowerCase()}.`}
          next={nextStepsFor(dimension.dimension)}
          className="mt-4"
        />
      ) : (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-text-primary">
          {dimension.value.values.map((value) => (
            <li key={value}>
              <span>{value}</span>
              {correctedSource && value.includes(correctedSource.label) ? (
                <ProvenanceTag provenance="user" className="ml-2" />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {!noSignal && explanation && onCorrect ? (
        <CorrectionControls
          dimension={dimension.dimension}
          explanation={explanation}
          onCorrect={onCorrect}
        />
      ) : null}
    </div>
  );

  return evidence.length > 0 && dimension.confidence > 0 ? (
    <AiSurface
      evidence={evidence}
      confidence={confidence}
      label={`Career state: ${label}`}
    >
      {body}
    </AiSurface>
  ) : body;
}

function CorrectionControls({
  dimension,
  explanation,
  onCorrect,
}: {
  readonly dimension: CieDimensionKey;
  readonly explanation: CieStateExplainResponse;
  readonly onCorrect: NonNullable<CareerStateReviewProps['onCorrect']>;
}): JSX.Element | null {
  const sources = explanation.evidence.map(editableEvidence).filter(isEditableEvidence);
  if (sources.length === 0) return null;
  return (
    <div className="mt-4 space-y-2 border-t border-border-subtle pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Correct a source fact
      </p>
      {sources.map((source) => (
        <CorrectionForm
          key={source.ref}
          dimension={dimension}
          source={source}
          onCorrect={onCorrect}
        />
      ))}
    </div>
  );
}

function CorrectionForm({
  dimension,
  source,
  onCorrect,
}: {
  readonly dimension: CorrectionContext;
  readonly source: EditableEvidence;
  readonly onCorrect: NonNullable<CareerStateReviewProps['onCorrect']>;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(source.label);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const next = label.trim();
    if (next.length === 0) return;
    setSaving(true);
    const saved = await onCorrect(dimension, source, next);
    setSaving(false);
    if (saved) setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-text-secondary">{source.label}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-md border border-border-strong px-2 py-1 text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand-base"
          aria-label={`Correct source fact: ${source.label}`}
        >
          Correct
        </button>
      </div>
    );
  }

  const inputId = `correction-${dimension}-${source.id}`;
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-text-primary">
        Corrected {source.kind} fact
      </label>
      <input
        id={inputId}
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        disabled={saving}
        required
        className="w-full rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand-base"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || label.trim().length === 0}
          className="rounded-md bg-brand-base px-3 py-1.5 text-sm font-medium text-text-inverse outline-none focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-50"
        >
          {saving ? 'Saving correction…' : 'Save correction'}
        </button>
        <button
          type="button"
          onClick={() => {
            setLabel(source.label);
            setEditing(false);
          }}
          disabled={saving}
          className="rounded-md border border-border-strong px-3 py-1.5 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand-base"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export interface EditableEvidence {
  readonly ref: string;
  readonly id: string;
  readonly kind: ProfileFactEditRequest['kind'];
  readonly label: string;
}

function editableEvidence(
  source: CieStateExplainResponse['evidence'][number],
): EditableEvidence | null {
  const separator = source.ref.indexOf(':');
  if (separator < 1) return null;
  const kind = source.ref.slice(0, separator);
  const id = source.ref.slice(separator + 1);
  if (!isFactKind(kind) || id.length === 0) return null;
  return { ref: source.ref, id, kind, label: source.label };
}

function isEditableEvidence(value: EditableEvidence | null): value is EditableEvidence {
  return value !== null;
}

function isFactKind(value: string): value is ProfileFactEditRequest['kind'] {
  return value === 'experience' || value === 'project' || value === 'education' || value === 'skill';
}

function confidenceFor(dimension: CieStateDimension): Confidence {
  return {
    value: dimension.confidence,
    band: bandFor(dimension.confidence),
    source: dimension.modelVersion,
  };
}

function evidenceFor(explanation?: CieStateExplainResponse): Evidence[] {
  return (explanation?.evidence ?? []).map((source) => ({
    id: source.ref,
    source: source.kind,
    snippet: source.label,
  }));
}

function stateProvenance(value: CieStateDimension['provenance']): Provenance {
  switch (value) {
    case 'no-signal': return 'no_signal';
    case 'demonstrated': return 'demonstrated';
    case 'inferred': return 'inferred';
    case 'summarized': return 'summarized';
  }
}

function dimensionLabel(dimension: CieDimensionKey): string {
  return dimension.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());
}

function skillFraming(dimension: CieDimensionKey): ReactNode {
  if (dimension === 'demonstrated_skills') {
    return <p className="mt-2 text-sm font-medium text-confidence-high">Demonstrated in your evidence</p>;
  }
  if (dimension === 'inferred_skills') {
    return <p className="mt-2 text-sm font-medium text-confidence-med">Inferred by AI — review carefully</p>;
  }
  return null;
}

function nextStepsFor(dimension: CieDimensionKey): ReadonlyArray<{ id: string; label: string }> {
  return [
    {
      id: `${dimension}-profile`,
      label: 'Add a specific, factual example to your profile.',
    },
    {
      id: `${dimension}-review`,
      label: 'Review this dimension again after adding evidence.',
    },
  ];
}