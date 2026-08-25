'use client';

import {
  pkmCreateRequestSchema,
  pkmDeleteResponseSchema,
  pkmEntrySchema,
  pkmListResponseSchema,
  pkmUpdateRequestSchema,
  type PkmCreateRequest,
  type PkmDeleteResponse,
  type PkmEntry,
  type PkmListResponse,
  type PkmUpdateRequest,
} from '@careeros/contracts';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ApiError, apiClient, createApi } from '@/api';
import { buildOptimistic, ErrorRecoveryRenderer, ListSkeleton, runOptimistic } from '@/shell/state';
import { ProvenanceTag } from '@/trust';

export interface PkmRoomDependencies {
  readonly list: () => Promise<PkmListResponse>;
  readonly create: (body: PkmCreateRequest) => Promise<PkmEntry>;
  readonly update: (id: string, body: PkmUpdateRequest) => Promise<PkmEntry>;
  readonly delete: (id: string) => Promise<PkmDeleteResponse>;
}

type PersistedRow = {
  readonly kind: 'persisted';
  readonly entry: PkmEntry;
  readonly pending?: 'update';
};

type PendingCreateRow = {
  readonly kind: 'pending-create';
  readonly key: string;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
};

type PkmRow = PersistedRow | PendingCreateRow;

type RoomState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: ApiError }
  | { readonly kind: 'ready'; readonly rows: readonly PkmRow[] };

type MutationFailure = {
  readonly error: ApiError;
  readonly operation: 'create' | 'update' | 'delete';
};

function productionDependencies(): PkmRoomDependencies {
  const pkm = createApi(apiClient()).pkm;
  return {
    list: () => pkm.list(),
    create: (body) => pkm.create(body),
    update: (id, body) => pkm.update(id, body),
    delete: (id) => pkm.delete(id),
  };
}

function asApiError(cause: unknown, fallback: string): ApiError {
  return cause instanceof ApiError ? cause : new ApiError({
    code: 'internal',
    message: cause instanceof Error ? cause.message : fallback,
  });
}

function tagsFromInput(value: string): string[] {
  return value.split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0);
}

function persisted(entry: PkmEntry, pending?: 'update'): PersistedRow {
  return { kind: 'persisted', entry, ...(pending ? { pending } : {}) };
}

function replaceEntry(rows: readonly PkmRow[], id: string, row: PkmRow): readonly PkmRow[] {
  return rows.map((current) => current.kind === 'persisted' && current.entry.id === id ? row : current);
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'UTC', timeZoneName: 'short',
  }).format(new Date(value));
}

export function PkmRoomClient({ dependencies }: { readonly dependencies?: PkmRoomDependencies }): JSX.Element {
  const [deps] = useState(() => dependencies ?? productionDependencies());
  const [state, setState] = useState<RoomState>({ kind: 'loading' });
  const [mutationFailure, setMutationFailure] = useState<MutationFailure | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<PkmEntry | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    setMutationFailure(null);
    try {
      const response = pkmListResponseSchema.parse(await deps.list());
      setState({ kind: 'ready', rows: response.data.map((entry) => persisted(entry)) });
    } catch (cause) {
      setState({ kind: 'error', error: asApiError(cause, 'Your personal knowledge could not be loaded.') });
    }
  }, [deps]);

  useEffect(() => { void load(); }, [load]);

  async function createEntry(input: PkmCreateRequest): Promise<boolean> {
    if (state.kind !== 'ready') return false;
    const request = pkmCreateRequestSchema.parse(input);
    const snapshot = state.rows;
    const key = `pending-${String(Date.now())}-${request.title}`;
    const optimistic: PendingCreateRow = {
      kind: 'pending-create', key, title: request.title, body: request.body, tags: request.tags ?? [],
    };
    setMutationFailure(null);
    try {
      await runOptimistic(buildOptimistic({
        snapshot,
        patch: (rows) => [optimistic, ...rows],
        commit: async () => pkmEntrySchema.parse(await deps.create(request)),
        setState: (rows) => setState({ kind: 'ready', rows }),
        mergeServer: (entry, rows) => rows.map((row) => row.kind === 'pending-create' && row.key === key ? persisted(entry) : row),
      }));
      return true;
    } catch (cause) {
      setMutationFailure({ error: asApiError(cause, 'Your entry could not be created.'), operation: 'create' });
      return false;
    }
  }

  async function updateEntry(entry: PkmEntry, input: PkmUpdateRequest): Promise<boolean> {
    if (state.kind !== 'ready') return false;
    const request = pkmUpdateRequestSchema.parse(input);
    const snapshot = state.rows;
    const optimisticEntry = pkmEntrySchema.parse({ ...entry, ...request });
    setMutationFailure(null);
    setEditingId(null);
    try {
      await runOptimistic(buildOptimistic({
        snapshot,
        patch: (rows) => replaceEntry(rows, entry.id, persisted(optimisticEntry, 'update')),
        commit: async () => pkmEntrySchema.parse(await deps.update(entry.id, request)),
        setState: (rows) => setState({ kind: 'ready', rows }),
        mergeServer: (updated, rows) => replaceEntry(rows, entry.id, persisted(updated)),
      }));
      setEditingId(null);
      return true;
    } catch (cause) {
      setMutationFailure({ error: asApiError(cause, 'Your entry could not be updated.'), operation: 'update' });
      setEditingId(entry.id);
      return false;
    }
  }

  async function deleteEntry(entry: PkmEntry): Promise<void> {
    if (state.kind !== 'ready') return;
    const snapshot = state.rows;
    setDeleteCandidate(null);
    setMutationFailure(null);
    try {
      await runOptimistic(buildOptimistic({
        snapshot,
        patch: (rows) => rows.filter((row) => row.kind !== 'persisted' || row.entry.id !== entry.id),
        commit: async () => pkmDeleteResponseSchema.parse(await deps.delete(entry.id)),
        setState: (rows) => setState({ kind: 'ready', rows }),
        mergeServer: (_response, rows) => rows,
      }));
      if (editingId === entry.id) setEditingId(null);
    } catch (cause) {
      setMutationFailure({ error: asApiError(cause, 'Your entry could not be deleted.'), operation: 'delete' });
    }
  }

  if (state.kind === 'loading') return <ListSkeleton rows={2} label="Loading your personal knowledge…" testId="pkm-loading" />;
  if (state.kind === 'error') return <ErrorRecoveryRenderer error={state.error} onRetry={() => void load()} />;

  return (
    <div className="space-y-6" data-testid="pkm-room">
      <EntryForm mode="create" onSubmit={createEntry} />

      {mutationFailure ? (
        <section aria-label={`${mutationFailure.operation} entry recovery`} className="space-y-2">
          <ErrorRecoveryRenderer
            error={mutationFailure.error}
            onRetry={mutationFailure.operation === 'delete' ? () => void load() : () => setMutationFailure(null)}
            onResolveConflict={() => void load()}
            onReauthenticate={() => { window.location.assign('/sign-in'); }}
          />
          <button type="button" onClick={() => mutationFailure.operation === 'delete' ? void load() : setMutationFailure(null)} className="rounded-md border border-brand-base px-3 py-1 text-sm font-semibold text-brand-base focus-visible:ring-2 focus-visible:ring-brand-base">
            {mutationFailure.operation === 'delete' ? 'Reload entries' : 'Review and try again'}
          </button>
        </section>
      ) : null}

      <section aria-labelledby="pkm-list-heading">
        <h2 id="pkm-list-heading" className="text-lg font-semibold text-text-primary">Your entries</h2>
        {state.rows.length === 0 ? (
          <div className="mt-3 rounded-lg border border-border-subtle bg-bg-subtle p-5" data-testid="pkm-empty">
            <p className="font-semibold text-text-primary">No entries yet</p>
            <p className="mt-1 text-sm text-text-secondary">Use the create form above to add your first entry.</p>
          </div>
        ) : (
          <ul className="mt-3 space-y-4">
            {state.rows.map((row) => row.kind === 'pending-create' ? (
              <li key={row.key}><PendingEntryCard row={row} /></li>
            ) : (
              <li key={row.entry.id}>
                {editingId === row.entry.id ? (
                  <EntryForm
                    mode="edit"
                    entry={row.entry}
                    onCancel={() => setEditingId(null)}
                    onSubmit={(input) => updateEntry(row.entry, input)}
                  />
                ) : (
                  <EntryCard
                    row={row}
                    onEdit={() => { setMutationFailure(null); setEditingId(row.entry.id); }}
                    onDelete={() => setDeleteCandidate(row.entry)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {deleteCandidate ? (
        <DeleteEntryConfirmation
          entry={deleteCandidate}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={() => void deleteEntry(deleteCandidate)}
        />
      ) : null}
    </div>
  );
}

type EntryFormProps =
  | {
      readonly mode: 'create';
      readonly entry?: never;
      readonly onSubmit: (input: PkmCreateRequest) => Promise<boolean>;
      readonly onCancel?: never;
    }
  | {
      readonly mode: 'edit';
      readonly entry: PkmEntry;
      readonly onSubmit: (input: PkmUpdateRequest) => Promise<boolean>;
      readonly onCancel: () => void;
    };

function EntryForm(props: EntryFormProps): JSX.Element {
  const { mode, entry, onCancel } = props;
  const [title, setTitle] = useState(entry?.title ?? '');
  const [body, setBody] = useState(entry?.body ?? '');
  const [tags, setTags] = useState(entry?.tags.join(', ') ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const headingId = useId();

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalizedTags = tagsFromInput(tags);
    const candidate = mode === 'create'
      ? { title, body, tags: normalizedTags }
      : {
          ...(title !== entry?.title ? { title } : {}),
          ...(body !== entry?.body ? { body } : {}),
          ...(normalizedTags.join('\u0000') !== (entry?.tags ?? []).join('\u0000') ? { tags: normalizedTags } : {}),
        };
    const parsed = mode === 'create' ? pkmCreateRequestSchema.safeParse(candidate) : pkmUpdateRequestSchema.safeParse(candidate);
    if (!parsed.success) { setValidation(parsed.error.issues.map((issue) => issue.message).join(' ')); return; }
    setValidation(null);
    setSubmitting(true);
    const saved = mode === 'create'
      ? await props.onSubmit(pkmCreateRequestSchema.parse(candidate))
      : await props.onSubmit(pkmUpdateRequestSchema.parse(candidate));
    setSubmitting(false);
    if (saved && mode === 'create') {
      setTitle(''); setBody(''); setTags('');
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-labelledby={headingId} className="rounded-lg border border-border-subtle bg-bg-surface p-5" data-testid={`pkm-${mode}-form`}>
      <h2 id={headingId} className="text-lg font-semibold text-text-primary">{mode === 'create' ? 'Create an entry' : `Edit ${entry?.title ?? 'entry'}`}</h2>
      <div className="mt-4 grid gap-4">
        <label className="grid gap-1 text-sm font-medium text-text-primary">Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required className="rounded-md border border-border-strong bg-bg-base px-3 py-2 focus-visible:ring-2 focus-visible:ring-brand-base" />
        </label>
        <label className="grid gap-1 text-sm font-medium text-text-primary">Body
          <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={50000} required rows={mode === 'create' ? 4 : 6} className="rounded-md border border-border-strong bg-bg-base px-3 py-2 focus-visible:ring-2 focus-visible:ring-brand-base" />
        </label>
        <label className="grid gap-1 text-sm font-medium text-text-primary">Tags <span className="font-normal text-text-muted">Optional, comma-separated</span>
          <input value={tags} onChange={(event) => setTags(event.target.value)} className="rounded-md border border-border-strong bg-bg-base px-3 py-2 focus-visible:ring-2 focus-visible:ring-brand-base" />
        </label>
      </div>
      {validation ? <p role="alert" className="mt-3 text-sm text-tier-red">{validation}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={submitting} className="rounded-md bg-brand-base px-4 py-2 text-sm font-semibold text-bg-base focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-60">{submitting ? 'Saving…' : mode === 'create' ? 'Create entry' : 'Save changes'}</button>
        {mode === 'edit' ? <button type="button" disabled={submitting} onClick={onCancel} className="rounded-md border border-border-subtle px-4 py-2 text-sm text-text-secondary focus-visible:ring-2 focus-visible:ring-brand-base">Cancel edit</button> : null}
      </div>
    </form>
  );
}

function EntryCard({ row, onEdit, onDelete }: { readonly row: PersistedRow; readonly onEdit: () => void; readonly onDelete: () => void }): JSX.Element {
  const { entry } = row;
  return (
    <article aria-labelledby={`pkm-entry-${entry.id}`} className="rounded-lg border border-border-subtle bg-bg-elevated p-5" data-testid={`pkm-entry-${entry.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`pkm-entry-${entry.id}`} className="text-lg font-semibold text-text-primary">{entry.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <ProvenanceTag provenance={entry.provenance} />
            <span className="text-xs text-text-muted">Provenance: <code>{entry.provenance}</code></span>
          </div>
        </div>
        {row.pending ? <span role="status" className="text-xs font-semibold text-brand-base">Saving changes…</span> : null}
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm text-text-secondary">{entry.body}</p>
      <ul aria-label={`Tags for ${entry.title}`} className="mt-3 flex flex-wrap gap-2">
        {entry.tags.length === 0 ? <li className="text-xs text-text-muted">No tags</li> : entry.tags.map((tag) => <li key={tag} className="rounded-full border border-border-subtle bg-bg-subtle px-2 py-1 text-xs text-text-secondary">{tag}</li>)}
      </ul>
      <dl className="mt-4 grid gap-2 text-xs text-text-muted sm:grid-cols-2">
        <div><dt className="font-semibold text-text-secondary">Created</dt><dd><time dateTime={entry.createdAt}>{formatTimestamp(entry.createdAt)}</time></dd></div>
        <div><dt className="font-semibold text-text-secondary">Updated</dt><dd><time dateTime={entry.updatedAt}>{formatTimestamp(entry.updatedAt)}</time></dd></div>
      </dl>
      <div className="mt-4 flex gap-2">
        <button type="button" disabled={row.pending !== undefined} onClick={onEdit} className="rounded-md border border-border-subtle px-3 py-1 text-sm font-semibold text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-60">Edit</button>
        <button type="button" disabled={row.pending !== undefined} onClick={onDelete} className="rounded-md border border-tier-red px-3 py-1 text-sm font-semibold text-tier-red focus-visible:ring-2 focus-visible:ring-tier-red disabled:opacity-60">Delete</button>
      </div>
    </article>
  );
}

function PendingEntryCard({ row }: { readonly row: PendingCreateRow }): JSX.Element {
  return (
    <article aria-label={`Saving ${row.title}`} className="rounded-lg border border-brand-base bg-bg-subtle p-5" data-testid="pkm-pending-entry">
      <div className="flex flex-wrap items-start justify-between gap-3"><h3 className="text-lg font-semibold text-text-primary">{row.title}</h3><span role="status" className="text-xs font-semibold text-brand-base">Saving entry…</span></div>
      <p className="mt-3 whitespace-pre-wrap text-sm text-text-secondary">{row.body}</p>
      {row.tags.length > 0 ? <p className="mt-3 text-xs text-text-muted">Tags: {row.tags.join(', ')}</p> : null}
      <p className="mt-3 text-xs text-text-muted">Provenance and timestamps will appear only after the server saves this entry.</p>
    </article>
  );
}

function DeleteEntryConfirmation({ entry, onConfirm, onCancel }: { readonly entry: PkmEntry; readonly onConfirm: () => void; readonly onCancel: () => void }): JSX.Element {
  const headingId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(event: KeyboardEvent): void { if (event.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-base/80 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby={headingId} className="w-full max-w-lg rounded-lg border border-tier-red bg-bg-elevated p-5 shadow-lg">
        <h2 id={headingId} className="text-xl font-semibold text-text-primary">Delete this entry? This can&apos;t be undone.</h2>
        <p className="mt-2 text-sm text-text-secondary">You are deleting “{entry.title}”. This is a Green action on your own data and does not use an approval token.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} className="rounded-md border border-border-subtle px-4 py-2 text-sm text-text-secondary focus-visible:ring-2 focus-visible:ring-brand-base">Keep entry</button>
          <button type="button" onClick={onConfirm} className="rounded-md bg-tier-red px-4 py-2 text-sm font-semibold text-text-inverse focus-visible:ring-2 focus-visible:ring-tier-red">Delete entry permanently</button>
        </div>
      </div>
    </div>
  );
}