'use client';

/**
 * Toast region — an ARIA-live landmark that any part of the app can push
 * transient messages into via `pushToast()`. Rendered once by the AppShell.
 *
 * FM1 keeps this deliberately minimal: no queueing, no priorities, no
 * per-type styling. Later batches (Trust Kit approvals feedback, network
 * errors, SSE reconnects) will grow it.
 *
 * Uses `role="status"` + `aria-live="polite"` so screen readers announce
 * new messages without stealing focus. The container is always present in
 * the DOM (even when empty) so the live region works — collapsing/hiding
 * it would defeat SR announcements.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

interface Toast {
  id: number;
  message: string;
}

type Listener = () => void;

let nextId = 1;
let toasts: readonly Toast[] = [];
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l();
}

/** Push a message onto the toast queue. Safe to call from server or client. */
export function pushToast(message: string, options: { ttlMs?: number } = {}): void {
  const id = nextId++;
  toasts = [...toasts, { id, message }];
  notify();
  const ttl = options.ttlMs ?? 4000;
  if (typeof setTimeout !== 'undefined') {
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
      notify();
    }, ttl);
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly Toast[] {
  return toasts;
}

/** Test-only reset. */
export function _resetToastsForTests(): void {
  toasts = [];
  nextId = 1;
  listeners.clear();
}

export function ToastRegion(): JSX.Element {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // Avoid an SSR/CSR mismatch: only render toast children after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-relevant="additions text"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      data-testid="toast-region"
    >
      {mounted &&
        current.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto rounded-md border border-border-subtle bg-bg-elevated px-4 py-2 text-sm text-text-primary shadow-sm"
          >
            {t.message}
          </div>
        ))}
    </div>
  );
}