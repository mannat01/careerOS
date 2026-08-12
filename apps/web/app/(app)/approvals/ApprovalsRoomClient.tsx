'use client';

import {
  approvalDenyRequestSchema,
  approvalEditRequestSchema,
  approvalExecuteRequestSchema,
  approvalMintRequestSchema,
  type ApprovalDenyResponse,
  type ApprovalEditResponse,
  type ApprovalExecuteResponse,
  type ApprovalMintResponse,
  type PendingApproval,
  type PendingApprovalListResponse,
} from '@careeros/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiClient, createApi } from '@/api';
import { setPendingApprovalsCount } from '@/shell';
import { ErrorRecoveryRenderer, ListSkeleton } from '@/shell/state';
import { TierBadge } from '@/trust';

export interface ApprovalsRoomDependencies {
  readonly list: () => Promise<PendingApprovalListResponse>;
  readonly mint: (id: string, payload: PendingApproval['payload']) => Promise<ApprovalMintResponse>;
  readonly edit: (id: string, payload: PendingApproval['payload']) => Promise<ApprovalEditResponse>;
  readonly execute: (
    id: string,
    token: ApprovalMintResponse['token'],
    payload: PendingApproval['payload'],
  ) => Promise<ApprovalExecuteResponse>;
  readonly deny: (id: string, reason: string) => Promise<ApprovalDenyResponse>;
}

function productionDependencies(): ApprovalsRoomDependencies {
  const approvals = createApi(apiClient()).approvals;
  return {
    list: () => approvals.listPending(),
    mint: (id, payload) => approvals.mint(id, approvalMintRequestSchema.parse({ approvalId: id, payload })),
    edit: (id, payload) => approvals.edit(id, approvalEditRequestSchema.parse({ approvalId: id, payload })),
    execute: (id, token, payload) => approvals.execute(id, approvalExecuteRequestSchema.parse({ token, payload })),
    deny: (id, reason) => approvals.deny(id, approvalDenyRequestSchema.parse({ approvalId: id, reason })),
  };
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly approvals: readonly PendingApproval[] }
  | { readonly kind: 'error'; readonly error: ApiError };

interface LifecycleNotice {
  readonly id: string;
  readonly kind: 'executed' | 'denied';
  readonly message: string;
}

function asApiError(cause: unknown): ApiError {
  return cause instanceof ApiError ? cause : new ApiError({
    code: 'internal',
    message: cause instanceof Error ? cause.message : 'Approval request failed.',
  });
}

export function ApprovalsRoomClient({
  dependencies,
}: {
  readonly dependencies?: ApprovalsRoomDependencies;
}): JSX.Element {
  const [deps] = useState(() => dependencies ?? productionDependencies());
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [selected, setSelected] = useState<PendingApproval | null>(null);
  const [notice, setNotice] = useState<LifecycleNotice | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      const response = await deps.list();
      setPendingApprovalsCount(response.data.length);
      setState({ kind: 'ready', approvals: response.data });
    } catch (cause) {
      setState({ kind: 'error', error: asApiError(cause) });
    }
  }, [deps]);

  useEffect(() => { void load(); }, [load]);

  const removeResolved = useCallback((id: string): void => {
    setState((current) => {
      if (current.kind !== 'ready') return current;
      const approvals = current.approvals.filter((item) => item.id !== id);
      setPendingApprovalsCount(approvals.length);
      return { kind: 'ready', approvals };
    });
    setSelected(null);
  }, []);

  if (state.kind === 'loading') return <ListSkeleton rows={3} />;
  if (state.kind === 'error') {
    return <ErrorRecoveryRenderer error={state.error} onRetry={() => void load()} />;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="approvals-room">
      {notice ? (
        <section role="status" data-testid="approval-outcome" className="rounded-md border border-border-subtle bg-bg-elevated p-4 text-sm text-text-primary">
          <h2 className="font-semibold">{notice.kind === 'executed' ? 'Action executed' : 'Approval denied'}</h2>
          <p className="mt-1 text-text-secondary">{notice.message}</p>
        </section>
      ) : null}

      {state.approvals.length === 0 ? (
        <div role="status" className="rounded-lg border border-dashed border-border-subtle bg-bg-elevated p-6 text-center text-text-muted">
          <p className="text-sm">No pending approvals. Nothing is waiting for your decision.</p>
        </div>
      ) : (
        <ul className="space-y-4" aria-label="Pending approvals">
          {state.approvals.map((approval) => (
            <li key={approval.id}>
              <article aria-labelledby={`approval-${approval.id}`} data-testid={`approval-card-${approval.id}`} className="rounded-lg border border-border-subtle bg-bg-elevated p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 id={`approval-${approval.id}`} className="font-semibold text-text-primary">{approval.action}</h2>
                    <p className="mt-1 text-sm text-text-secondary">{approval.why}</p>
                  </div>
                  <TierBadge tier={approval.tier} label={`${approval.tier} · ${approval.state}`} />
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="font-medium text-text-muted">State</dt><dd className="text-text-primary">{approval.state}</dd></div>
                  <div><dt className="font-medium text-text-muted">Created</dt><dd className="text-text-primary"><time dateTime={approval.createdAt}>{approval.createdAt}</time></dd></div>
                </dl>
                <h3 className="mt-4 text-sm font-medium text-text-primary">Exact payload</h3>
                <pre data-testid={`approval-payload-${approval.id}`} className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-md bg-bg-subtle p-3 text-xs text-text-primary">{JSON.stringify(approval.payload, null, 2)}</pre>
                <h3 className="mt-4 text-sm font-medium text-text-primary">Resource references</h3>
                {approval.resourceRefs.length === 0 ? <p className="mt-1 text-sm text-text-muted">No resource references were returned.</p> : (
                  <ul className="mt-1 space-y-1 text-xs text-text-secondary">
                    {approval.resourceRefs.map((ref) => <li key={`${ref.type}-${ref.id}`}><span className="font-medium">{ref.type}:</span> {ref.id}</li>)}
                  </ul>
                )}
                <button type="button" onClick={() => setSelected(approval)} className="mt-4 rounded-md border border-tier-yellow px-3 py-2 text-sm font-semibold text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base">
                  Review approval
                </button>
              </article>
            </li>
          ))}
        </ul>
      )}

      {selected ? (
        <ApprovalLifecycleDialog
          approval={selected}
          dependencies={deps}
          onClose={() => setSelected(null)}
          onEdited={(edited) => {
            setState((current) => current.kind === 'ready' ? {
              kind: 'ready',
              approvals: current.approvals.map((item) => item.id === edited.id ? edited : item),
            } : current);
            setSelected(edited);
          }}
          onMinted={() => {
            const approved: PendingApproval = { ...selected, state: 'approved' };
            setState((current) => current.kind === 'ready' ? {
              kind: 'ready',
              approvals: current.approvals.map((item) => item.id === approved.id ? approved : item),
            } : current);
            setSelected(approved);
          }}
          onReload={() => { setSelected(null); void load(); }}
          onExecuted={(response) => {
            setNotice({ id: response.approvalId, kind: 'executed', message: `${response.outcome} (${response.action})` });
            removeResolved(response.approvalId);
          }}
          onDenied={(response) => {
            setNotice({ id: response.approvalId, kind: 'denied', message: `Denied at ${response.deniedAt}. No action was executed.` });
            removeResolved(response.approvalId);
          }}
        />
      ) : null}
    </div>
  );
}

function ApprovalLifecycleDialog({
  approval,
  dependencies,
  onClose,
  onEdited,
  onMinted,
  onReload,
  onExecuted,
  onDenied,
}: {
  readonly approval: PendingApproval;
  readonly dependencies: ApprovalsRoomDependencies;
  readonly onClose: () => void;
  readonly onEdited: (approval: PendingApproval) => void;
  readonly onMinted: () => void;
  readonly onReload: () => void;
  readonly onExecuted: (response: ApprovalExecuteResponse) => void;
  readonly onDenied: (response: ApprovalDenyResponse) => void;
}): JSX.Element {
  const [payloadText, setPayloadText] = useState(() => JSON.stringify(approval.payload, null, 2));
  const [grant, setGrant] = useState<ApprovalMintResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<'edit' | 'mint' | 'execute' | 'deny' | null>(null);
  const [denyReason, setDenyReason] = useState('');
  const initialPayloadTextRef = useRef(payloadText);
  const closeRef = useRef<HTMLButtonElement>(null);
  const payloadChanged = payloadText !== initialPayloadTextRef.current;

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' && busy === null) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  function parsePayload(): PendingApproval['payload'] | null {
    try {
      const value: unknown = JSON.parse(payloadText);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Payload must be a JSON object.');
      return value as PendingApproval['payload'];
    } catch (cause) {
      setError(new ApiError({ code: 'validation_failed', message: cause instanceof Error ? cause.message : 'Payload must be valid JSON.' }));
      return null;
    }
  }

  async function saveEdit(): Promise<void> {
    const payload = parsePayload();
    if (!payload) return;
    setBusy('edit');
    setError(null);
    setGrant(null);
    try {
      const response = await dependencies.edit(approval.id, payload);
      const edited: PendingApproval = { ...approval, payload: response.payload, state: response.state };
      initialPayloadTextRef.current = JSON.stringify(response.payload, null, 2);
      setPayloadText(initialPayloadTextRef.current);
      onEdited(edited);
    } catch (cause) {
      setError(asApiError(cause));
    } finally {
      setBusy(null);
    }
  }

  async function mint(): Promise<void> {
    const payload = parsePayload();
    if (!payload || payloadChanged) return;
    setBusy('mint');
    setError(null);
    setGrant(null);
    try {
      setGrant(await dependencies.mint(approval.id, payload));
      onMinted();
    } catch (cause) {
      setError(asApiError(cause));
    } finally {
      setBusy(null);
    }
  }

  async function execute(): Promise<void> {
    const payload = parsePayload();
    if (!payload || !grant || payloadChanged) return;
    const singleUseGrant = grant;
    setGrant(null);
    setBusy('execute');
    setError(null);
    try {
      onExecuted(await dependencies.execute(approval.id, singleUseGrant.token, payload));
    } catch (cause) {
      setError(asApiError(cause));
    } finally {
      setBusy(null);
    }
  }

  async function deny(): Promise<void> {
    const reason = denyReason.trim();
    if (!reason) return;
    setGrant(null);
    setBusy('deny');
    setError(null);
    try {
      onDenied(await dependencies.deny(approval.id, reason));
    } catch (cause) {
      setError(asApiError(cause));
    } finally {
      setBusy(null);
    }
  }

  const failureReason = typeof error?.details?.['reason'] === 'string' ? error.details['reason'] : null;
  const reapprovalFailure = failureReason === 'token_consumed' || failureReason === 'token_expired' || failureReason === 'payload_mismatch';
  const terminalConflict = error?.status === 409 || (error?.code === 'conflict' && error.details?.['state'] === 'denied');

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="approval-review-heading" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-bg-overlay p-4 pt-16">
      <div className="w-full max-w-2xl rounded-lg border border-border-subtle bg-bg-elevated p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="approval-review-heading" className="text-lg font-semibold text-text-primary">Review {approval.action}</h2>
            <p className="mt-1 text-sm text-text-secondary">{approval.why}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} disabled={busy !== null} className="rounded-md border border-border-subtle px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-50">Close</button>
        </div>
        <div className="mt-4"><TierBadge tier={approval.tier} label={`${approval.tier} · approval required`} /></div>

        <label htmlFor="approval-payload-editor" className="mt-4 block text-sm font-medium text-text-primary">Exact payload (JSON)</label>
        <textarea
          id="approval-payload-editor"
          data-testid="approval-payload-editor"
          value={payloadText}
          onChange={(event) => { setPayloadText(event.target.value); setGrant(null); setError(null); }}
          rows={10}
          disabled={busy !== null}
          className="mt-1 w-full rounded-md border border-border-subtle bg-bg-base p-3 font-mono text-xs text-text-primary focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-60"
        />
        {payloadChanged ? <p role="status" className="mt-2 text-sm text-tier-yellow">Payload changed. Save it, then request a new approval. Any prior token is unusable.</p> : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void saveEdit()} disabled={!payloadChanged || busy !== null} className="rounded-md border border-border-subtle px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-50">{busy === 'edit' ? 'Saving…' : 'Save payload changes'}</button>
          <button type="button" onClick={() => void mint()} disabled={payloadChanged || busy !== null} className="rounded-md border border-tier-yellow px-3 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-50">{busy === 'mint' ? 'Approving…' : grant ? 'Re-approve exact payload' : 'Approve exact payload'}</button>
          <button type="button" onClick={() => void execute()} disabled={!grant || payloadChanged || busy !== null} className="rounded-md bg-tier-yellow px-3 py-2 text-sm font-semibold text-text-inverse focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-50">{busy === 'execute' ? 'Executing…' : 'Execute approved action'}</button>
        </div>

        {grant ? (
          <section role="status" data-testid="approval-grant" className="mt-3 rounded-md border border-border-subtle bg-bg-subtle p-3 text-xs text-text-secondary">
            <p className="font-semibold text-text-primary">Approved for this exact payload</p>
            <p>Action: {grant.action}</p><p>Payload hash: <code>{grant.payloadHash}</code></p><p>Expires: <time dateTime={grant.expiresAt}>{grant.expiresAt}</time></p>
          </section>
        ) : null}

        {reapprovalFailure ? (
          <section role="alert" data-testid="approval-token-recovery" className="mt-3 rounded-md border border-tier-yellow p-3 text-sm text-text-primary">
            <h3 className="font-semibold">Re-approval required</h3>
            <p>{failureReason}. The action did not succeed. Re-approve the exact current payload to mint a fresh token.</p>
          </section>
        ) : null}
        {terminalConflict ? (
          <section role="alert" data-testid="approval-terminal-recovery" className="mt-3 rounded-md border border-tier-yellow p-3 text-sm text-text-primary">
            <h3 className="font-semibold">This approval is already terminal</h3>
            <p>{error.message} Reload the pending list to use server truth; no action is shown as successful.</p>
            <button type="button" onClick={onReload} className="mt-2 rounded-md border border-border-subtle px-3 py-1 focus-visible:ring-2 focus-visible:ring-brand-base">Close and reload</button>
          </section>
        ) : null}
        {error && !reapprovalFailure && !terminalConflict ? <div className="mt-3"><ErrorRecoveryRenderer error={error} onRetry={() => setError(null)} /></div> : null}

        <fieldset className="mt-6 border-t border-border-subtle pt-4" disabled={busy !== null}>
          <legend className="text-sm font-semibold text-text-primary">Deny this approval</legend>
          <label htmlFor="approval-deny-reason" className="mt-2 block text-sm text-text-secondary">Reason</label>
          <input id="approval-deny-reason" value={denyReason} onChange={(event) => setDenyReason(event.target.value)} className="mt-1 w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-brand-base" />
          <button type="button" onClick={() => void deny()} disabled={!denyReason.trim() || busy !== null} className="mt-2 rounded-md border border-tier-yellow px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-50">{busy === 'deny' ? 'Denying…' : 'Deny approval'}</button>
        </fieldset>
      </div>
    </div>
  );
}
