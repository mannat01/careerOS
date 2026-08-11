'use client';

import { useEffect, useId, useRef, useState } from 'react';

export interface AppliedConfirmationDialogProps {
  readonly opportunityId: string;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * A distinct consequence step for ready → applied. This is deliberately not
 * a generic stage-move control: the user must affirm that they personally
 * submitted the application before the explicit `iSubmitted` flag is sent.
 */
export function AppliedConfirmationDialog({
  opportunityId,
  busy,
  onConfirm,
  onCancel,
}: AppliedConfirmationDialogProps): JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-base/80 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="w-full max-w-lg rounded-lg border border-border-strong bg-bg-elevated p-5 shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-base"
      >
        <h2 id={headingId} className="text-xl font-semibold text-text-primary">Confirm your application</h2>
        <p className="mt-2 text-sm text-text-secondary">
          CareerOS did not submit this application and cannot mark it applied for you.
          Confirm only if you personally submitted opportunity <code>{opportunityId}</code>.
        </p>
        <label className="mt-4 flex items-start gap-3 rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 h-4 w-4 focus-visible:ring-2 focus-visible:ring-brand-base"
          />
          <span>I applied to this myself</span>
        </label>
        <p className="mt-3 text-xs text-text-muted">
          This confirmation sends the explicit user-action flag required by the applied guard.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-md border border-border-subtle px-4 py-2 text-sm text-text-secondary focus-visible:ring-2 focus-visible:ring-brand-base disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!confirmed || busy}
            onClick={onConfirm}
            className="rounded-md bg-brand-base px-4 py-2 text-sm font-semibold text-bg-base focus-visible:ring-2 focus-visible:ring-brand-base disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Marking applied…' : 'Confirm I applied'}
          </button>
        </div>
      </div>
    </div>
  );
}