'use client';

/**
 * ⌘K Twin mount point — the header-anchored trigger + reserved slot where the
 * "Talk to your Twin" surface will hydrate in FM4. FM1 ships the placeholder:
 *   - a `<button>` that opens a stub dialog announcing "Twin is not wired yet"
 *   - a global ⌘K / Ctrl-K keydown that triggers the same button
 *   - a labelled, focusable region that satisfies axe (name + role)
 *
 * The affordance is present at all times so users learn the shortcut, and
 * so tests can assert the shell exposes a Twin entry point. Actual command
 * palette / conversation UI lands with the CIE + Twin milestones.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { pushToast } from './ToastRegion.js';

export function TwinMount(): JSX.Element {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const openPalette = useCallback(() => {
    setOpen(true);
    pushToast('Twin (⌘K) — the conversation surface wires in a later batch.');
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    // Return focus to the trigger so keyboard users don't lose their place.
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        openPalette();
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        closePalette();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, openPalette, closePalette]);

  return (
    <div data-testid="twin-mount">
      <button
        ref={buttonRef}
        type="button"
        onClick={openPalette}
        aria-label="Open Twin (Command K)"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-md border border-border-subtle bg-bg-elevated px-3 py-1.5 text-sm text-text-secondary transition-colors duration-fast hover:text-text-primary"
      >
        <span aria-hidden="true">⌘K</span>
        <span>Twin</span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Twin"
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 pt-24"
          onClick={closePalette}
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="w-full max-w-lg rounded-lg border border-border-subtle bg-bg-elevated p-6 shadow-lg"
          >
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Twin</h2>
            <p className="text-sm text-text-secondary">
              The Twin conversation surface is not yet wired. This placeholder
              proves the ⌘K entry point + reserved slot.
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={closePalette}
                className="rounded-md bg-brand-base px-3 py-1.5 text-sm text-text-inverse transition-colors duration-fast hover:bg-brand-emphasis"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}