/**
 * ARIA live-region helper — the sanctioned way for streaming and composing
 * surfaces (Twin `/rt/twin`, briefing "steps composing") to announce
 * incremental content to assistive tech.
 *
 * Per `frontend-architecture.md §8` and §9: "Twin streams into a live
 * region ... the briefing renders its steps composing rather than an
 * opaque spinner."
 *
 * Two exports:
 *
 *   - `<LiveRegion messages politeness />` — renders a persistent
 *     `role="status"` (polite) or `role="alert"` (assertive) region.
 *     Consumers push new lines into the `messages` array and the region
 *     appends them. Empty messages are ignored (never announces "").
 *
 *   - `announcePolitely(message)` / `announceAssertively(message)` — the
 *     imperative equivalent for one-shot announcements (e.g. "briefing
 *     step 2 of 4: scoring …"). Backed by a module-local subscriber set
 *     wired into the `<StreamingLiveRegion>` singleton mounted by
 *     `AppShell` (added in a later batch — the exports are already
 *     stable so callers can adopt them now).
 *
 * A11y invariants (asserted by tests):
 *   - The region is always mounted (never conditionally hidden) — hiding
 *     an SR live region breaks announcements.
 *   - `aria-live` reflects the requested politeness.
 *   - `aria-atomic="false"` so *incremental* additions are announced (not
 *     the whole log re-read every time — critical for streaming tokens).
 *   - Text is visually hidden by default (`sr-only`) but readable by SR.
 *     Set `visible` to render as normal text (useful for the composing
 *     steps UI where sighted users benefit from the same lines).
 */
import { useEffect, useState, useSyncExternalStore, type JSX } from 'react';

export type LivePoliteness = 'polite' | 'assertive';

export interface LiveRegionProps {
  /** Ordered messages to announce. Empty strings are filtered out. */
  readonly messages: readonly string[];
  /** ARIA politeness — polite (default) for streaming, assertive for errors. */
  readonly politeness?: LivePoliteness;
  /** Render text visibly (default: SR-only). */
  readonly visible?: boolean;
  /** Test id override. */
  readonly testId?: string;
}

/**
 * A single, always-mounted live region. `messages` is the incremental log;
 * we render one `<p>` per non-empty message so SR treats each addition as
 * a new announcement.
 */
export function LiveRegion({
  messages,
  politeness = 'polite',
  visible = false,
  testId = 'live-region',
}: LiveRegionProps): JSX.Element {
  const filtered = messages.filter((m) => m.length > 0);
  const role = politeness === 'assertive' ? 'alert' : 'status';
  return (
    <div
      role={role}
      aria-live={politeness}
      aria-atomic="false"
      aria-relevant="additions text"
      data-testid={testId}
      data-politeness={politeness}
      className={visible ? 'flex flex-col gap-1 text-sm text-text-primary' : 'sr-only'}
    >
      {filtered.map((m, i) => (
        <p key={`${testId}-msg-${String(i)}`} data-testid={`${testId}-msg`}>
          {m}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Imperative announcer — a module-level store the singleton region observes.
// ---------------------------------------------------------------------------

interface AnnouncerEntry {
  readonly id: number;
  readonly politeness: LivePoliteness;
  readonly message: string;
}

let nextAnnounceId = 1;
let announcements: readonly AnnouncerEntry[] = [];
const subs = new Set<() => void>();

function notify(): void {
  for (const l of subs) l();
}

function push(politeness: LivePoliteness, message: string): void {
  if (message.length === 0) return; // never announce ""
  const id = nextAnnounceId++;
  announcements = [...announcements, { id, politeness, message }];
  notify();
}

/** Announce a message politely (does not interrupt current SR speech). */
export function announcePolitely(message: string): void {
  push('polite', message);
}

/** Announce a message assertively (interrupts SR — use only for errors). */
export function announceAssertively(message: string): void {
  push('assertive', message);
}

/** Test-only reset. */
export function _resetLiveRegionForTests(): void {
  announcements = [];
  nextAnnounceId = 1;
  subs.clear();
}

function subscribe(l: () => void): () => void {
  subs.add(l);
  return () => {
    subs.delete(l);
  };
}

function getSnapshot(): readonly AnnouncerEntry[] {
  return announcements;
}

/**
 * Singleton region wired into the announcer — mount ONCE at the shell.
 * (Kept side-effect-free until mounted so importing the module is safe
 * in SSR contexts.)
 */
export function StreamingLiveRegion(): JSX.Element {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const polite = current.filter((a) => a.politeness === 'polite').map((a) => a.message);
  const assertive = current.filter((a) => a.politeness === 'assertive').map((a) => a.message);
  return (
    <>
      <LiveRegion
        messages={mounted ? polite : []}
        politeness="polite"
        testId="streaming-live-polite"
      />
      <LiveRegion
        messages={mounted ? assertive : []}
        politeness="assertive"
        testId="streaming-live-assertive"
      />
    </>
  );
}