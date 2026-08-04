/**
 * Loading skeletons — the designed loading state per `frontend-architecture.md §9`.
 *
 * "Loading: route-level skeletons ... rather than an opaque spinner."
 *
 * Two primitives, one shared visual language:
 *
 *   - `<RouteSkeleton>` — full-route placeholder used by Next.js `loading.tsx`
 *     files or client-side data-fetch guards. Renders a header + a body
 *     scaffold, communicates progress via a polite ARIA live region so
 *     screen readers hear "Loading …" instead of nothing.
 *
 *   - `<ListSkeleton rows>` — repeated row placeholder used by any list
 *     view (opportunities, approvals inbox, audit log, briefing steps).
 *
 * Both use only semantic tokens (`bg-bg-subtle`, `border-border-subtle`)
 * so light/dark themes work with no per-component code and the shared
 * `tokens.contrast.test.ts` guards contrast.
 *
 * A11y contract:
 *   - `role="status"` + `aria-live="polite"` + `aria-busy="true"` on the
 *     wrapping element so AT announces the state without stealing focus.
 *   - The visible label (e.g. "Loading …") is real text, never an SR-only
 *     hack — sighted users benefit too.
 *   - Skeleton bars are `aria-hidden="true"` (decoration only).
 *   - No CSS animation names that would trigger reduced-motion issues in
 *     axe; the shimmer is disabled when `prefers-reduced-motion: reduce`.
 */
import type { JSX } from 'react';

export interface RouteSkeletonProps {
  /** Optional label surfaced to screen readers and shown visibly. Defaults to "Loading …". */
  readonly label?: string;
  /** Test id override — defaults to `route-skeleton`. */
  readonly testId?: string;
}

/** Route-level skeleton — one heading + two content bars. */
export function RouteSkeleton({
  label = 'Loading …',
  testId = 'route-skeleton',
}: RouteSkeletonProps): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid={testId}
      className="flex flex-col gap-4 p-4"
    >
      <span className="text-sm text-text-secondary" data-testid={`${testId}-label`}>
        {label}
      </span>
      <div
        aria-hidden="true"
        className="h-6 w-1/3 rounded-md border border-border-subtle bg-bg-subtle motion-safe:animate-pulse"
      />
      <div
        aria-hidden="true"
        className="h-32 w-full rounded-md border border-border-subtle bg-bg-subtle motion-safe:animate-pulse"
      />
    </div>
  );
}

export interface ListSkeletonProps {
  /** Number of row placeholders to render. Defaults to 3. Clamped to [1, 20]. */
  readonly rows?: number;
  /** Optional label surfaced to screen readers. Defaults to "Loading list …". */
  readonly label?: string;
  /** Test id override. */
  readonly testId?: string;
}

/** List skeleton — N stacked row placeholders. */
export function ListSkeleton({
  rows = 3,
  label = 'Loading list …',
  testId = 'list-skeleton',
}: ListSkeletonProps): JSX.Element {
  const count = Math.max(1, Math.min(20, Math.trunc(rows)));
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid={testId}
      className="flex flex-col gap-2 p-2"
    >
      <span className="sr-only" data-testid={`${testId}-label`}>
        {label}
      </span>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={`${testId}-row-${String(i)}`}
          aria-hidden="true"
          data-testid={`${testId}-row`}
          className="h-10 w-full rounded-md border border-border-subtle bg-bg-subtle motion-safe:animate-pulse"
        />
      ))}
    </div>
  );
}