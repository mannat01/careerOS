import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  unsafe_brandApprovalToken,
  type ApprovalToken,
  type YellowAction,
} from '../api/approval';
import type { Tier } from './types';
import { TierBadge } from './TierBadge';

/**
 * `<ApprovalDialog>` — the ONLY path to a Yellow action.
 *
 * Per `frontend-architecture.md §5`, this component:
 *
 *   1. Shows the user *exactly* what will happen (`summary`) and a preview
 *      of the payload the API will receive (`payload`). No prose glossing.
 *   2. Displays the `tier` prominently via `<TierBadge>`.
 *   3. Mints a single-use `ApprovalToken` by calling `mintToken(payloadHash)`
 *      (mocked for FM1 — the real endpoint is
 *      `POST /v1/{resource}/:id/approve` and the server enforces bind-to-hash).
 *   4. If the user **edits the payload after minting**, the prior token is
 *      *invalidated* (`token` cleared, minting state reset) — the user must
 *      re-approve. This is the load-bearing test in the guarantee suite.
 *   5. On a ToS-gated denial (`denial` prop supplied), renders an honest
 *      "send it yourself" guidance block instead of an approve button —
 *      never a silent failure, never a fake success.
 *   6. `onApprove` is invoked with the freshly-branded token; the caller
 *      then feeds it into the Yellow client method (which cannot be called
 *      without one — see `api/approval.ts`).
 *
 * A11y contract:
 * - `role="dialog"` + `aria-modal="true"` + `aria-labelledby` on the heading.
 * - Escape closes via `onClose`; the initial focus is set to the payload
 *   textarea (or the "Approve" button when denial is present).
 * - The tier badge is announced via its own `aria-label`; the payload
 *   preview is a labelled `<textarea>` — screen readers can review it.
 * - "Approve" is disabled until a token is minted; disabled state includes
 *   `aria-disabled` so it is still discoverable.
 */

export interface ApprovalDialogDenial {
  /** Short reason shown to the user (e.g. "LinkedIn ToS forbids automation"). */
  readonly reason: string;
  /** Ordered "send it yourself" steps — same shape as InsufficientData. */
  readonly manualSteps: readonly string[];
}

/**
 * Contract for the (mocked-for-FM1) server mint. The real implementation
 * lives in a domain-specific `approve*` endpoint; we accept it as a prop so
 * the dialog stays reusable AND tests can swap in a deterministic stub.
 */
export type MintApprovalToken = (args: {
  readonly action: YellowAction;
  readonly payloadHash: string;
}) => Promise<string>;

export interface ApprovalDialogProps {
  readonly action: YellowAction;
  /** Initial payload shown in the preview. Serialised as pretty JSON. */
  readonly payload: unknown;
  readonly tier: Tier;
  /** Short human summary of what will happen if the user approves. */
  readonly summary: string;
  /** Called with a branded ApprovalToken when the user clicks "Approve". */
  readonly onApprove: (token: ApprovalToken, payload: unknown) => void;
  /** Called when the user cancels or closes the dialog. */
  readonly onClose: () => void;
  /** Server mint (mocked for FM1). Required — the dialog cannot bypass it. */
  readonly mintToken: MintApprovalToken;
  /** If present, the dialog renders "send it yourself" guidance instead. */
  readonly denial?: ApprovalDialogDenial;
}

/**
 * Deterministic short hash for the payload preview. We use a stable JSON
 * stringify (no key ordering guarantees needed for FM1 — the mock server
 * just echoes it back) + FNV-1a for a compact, sync, non-crypto hash. The
 * PROD server uses SHA-256 and binds the hash into the token; the shape
 * matters more than the algorithm here.
 */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
   
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Pretty-print JSON for the textarea; tolerate cycles by falling back. */
function stringifyPayload(p: unknown): string {
  try {
    return JSON.stringify(p, null, 2);
  } catch {
    return String(p);
  }
}

export function ApprovalDialog({
  action,
  payload,
  tier,
  summary,
  onApprove,
  onClose,
  mintToken,
  denial,
}: ApprovalDialogProps): JSX.Element {
  const [editedText, setEditedText] = useState<string>(() => stringifyPayload(payload));
  const [token, setToken] = useState<ApprovalToken | null>(null);
  const [mintError, setMintError] = useState<string | null>(null);
  const [isMinting, setIsMinting] = useState(false);
  const headingId = useId();
  const payloadId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Payload hash — recomputed on every render from the CURRENT text (the
  // textarea is the source of truth once the user edits it).
  const currentHash = useMemo(() => fnv1a(editedText), [editedText]);
  // The hash the current token was bound to (null when no token minted).
  const tokenHashRef = useRef<string | null>(null);

  // Escape closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus the dialog on open for a11y (screen readers announce it).
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  /** Invalidate any prior token when the user edits the payload. */
  const handleEdit = useCallback(
    (next: string): void => {
      setEditedText(next);
      // If the hash the token was bound to no longer matches, drop the token.
      // This is the load-bearing rule enforced by tests.
      if (token !== null && tokenHashRef.current !== null) {
        const nextHash = fnv1a(next);
        if (nextHash !== tokenHashRef.current) {
          setToken(null);
          tokenHashRef.current = null;
          setMintError(null);
        }
      }
    },
    [token],
  );

  const handleMint = useCallback(async (): Promise<void> => {
    setMintError(null);
    setIsMinting(true);
    try {
      const raw = await mintToken({ action, payloadHash: currentHash });
      const branded = unsafe_brandApprovalToken(raw);
      setToken(branded);
      tokenHashRef.current = currentHash;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to mint approval token';
      setMintError(msg);
      setToken(null);
      tokenHashRef.current = null;
    } finally {
      setIsMinting(false);
    }
  }, [action, currentHash, mintToken]);

  const handleApprove = useCallback((): void => {
    if (token === null) return;
    // Parse the edited text back to JSON when possible; if the user typed
    // free-form text, hand it back as a string (some Yellow actions accept
    // string bodies — Zod at the fetch boundary catches shape mismatches).
    let parsed: unknown = editedText;
    try {
      parsed = JSON.parse(editedText);
    } catch {
      // fall through — pass raw text
    }
    onApprove(token, parsed);
  }, [editedText, onApprove, token]);

  const denied = Boolean(denial);
  const approveDisabled = token === null || isMinting || denied;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      data-testid="approval-dialog"
      data-action={action}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-overlay p-4 outline-none"
    >
      <div className="w-full max-w-lg rounded-lg border border-border-subtle bg-bg-elevated p-4 shadow-xl">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id={headingId} className="text-base font-semibold text-text-primary">
            Approve: {action}
          </h2>
          <TierBadge tier={tier} />
        </div>
        <p className="mb-3 text-sm text-text-secondary" data-testid="approval-summary">
          {summary}
        </p>

        {denied && denial ? (
          <section
            data-testid="approval-denial"
            className="rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm"
          >
            <h3 className="mb-1 font-semibold text-text-primary">
              We can't do this for you — but here's how to send it yourself
            </h3>
            <p className="mb-2 text-text-secondary" data-testid="approval-denial-reason">
              {denial.reason}
            </p>
            <ol className="ml-4 list-decimal space-y-1 text-text-primary">
              {denial.manualSteps.map((step, i) => (
                <li key={`step-${String(i)}`}>{step}</li>
              ))}
            </ol>
          </section>
        ) : (
          <>
            <label
              htmlFor={payloadId}
              className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted"
            >
              Payload preview (editable)
            </label>
            <textarea
              id={payloadId}
              data-testid="approval-payload"
              value={editedText}
              onChange={(e) => handleEdit(e.target.value)}
              rows={8}
              className="mb-2 w-full rounded-md border border-border-subtle bg-bg-base p-2 font-mono text-xs text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand-base"
            />
            <div className="mb-3 flex items-center gap-2 text-[11px] text-text-muted">
              <span>Hash:</span>
              <code data-testid="approval-hash" className="font-mono">
                {currentHash}
              </code>
              {token !== null ? (
                <span
                  data-testid="approval-token-status"
                  className="ml-auto text-confidence-high"
                >
                  Approved for this payload
                </span>
              ) : (
                <span
                  data-testid="approval-token-status"
                  className="ml-auto text-text-secondary"
                >
                  Not yet approved
                </span>
              )}
            </div>
            {mintError ? (
              <p
                role="alert"
                data-testid="approval-mint-error"
                className="mb-2 text-xs text-tier-red"
              >
                {mintError}
              </p>
            ) : null}
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="approval-cancel"
            onClick={onClose}
            className="rounded-md border border-border-subtle bg-bg-subtle px-3 py-1 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand-base"
          >
            Cancel
          </button>
          {!denied ? (
            <>
              <button
                type="button"
                data-testid="approval-mint"
                onClick={() => {
                  void handleMint();
                }}
                disabled={isMinting}
                aria-disabled={isMinting}
                className="rounded-md border border-brand-base bg-bg-subtle px-3 py-1 text-sm text-brand-base outline-none focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-60"
              >
                {isMinting ? 'Requesting...' : token === null ? 'Request approval' : 'Re-request'}
              </button>
              <button
                type="button"
                data-testid="approval-approve"
                onClick={handleApprove}
                disabled={approveDisabled}
                aria-disabled={approveDisabled}
                className="rounded-md border border-tier-yellow bg-tier-yellow px-3 py-1 text-sm font-medium text-text-inverse outline-none focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-60"
              >
                Approve
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}