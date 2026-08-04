'use client';

/**
 * Approvals-count store — the shell's badge on the `Approvals` room reads
 * from here. In FM1 the count is always `0` (no approvals wired yet); FM4
 * populates it via SSE from the CIE surfaces.
 *
 * Deliberately tiny (no zustand/redux) — a single subscribable ref keeps the
 * shell test-friendly and avoids a client-bundle hit for one number.
 */

import { useSyncExternalStore } from 'react';

type Listener = () => void;

let count = 0;
const listeners = new Set<Listener>();

/** Update the pending-approvals count. Notifies all subscribed shells. */
export function setPendingApprovalsCount(next: number): void {
  const clamped = Math.max(0, Math.floor(next));
  if (clamped === count) return;
  count = clamped;
  for (const l of listeners) l();
}

/** Read the current count without subscribing (server-safe). */
export function getPendingApprovalsCount(): number {
  return count;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook the AppShell uses to render the badge. */
export function usePendingApprovalsCount(): number {
  return useSyncExternalStore(subscribe, getPendingApprovalsCount, getPendingApprovalsCount);
}

/** Test-only reset. */
export function _resetPendingApprovalsForTests(): void {
  count = 0;
  listeners.clear();
}