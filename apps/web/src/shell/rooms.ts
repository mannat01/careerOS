/**
 * Room registry — the single source of truth for the five top-level rooms
 * that make up the CareerOS authenticated shell.
 *
 * The five rooms (per FM1 Task 6 & docs/frontend-product-discovery.md):
 *   1. Today          — daily focus feed
 *   2. Opportunities  — pipeline of live opportunities
 *   3. Plan           — capacity, skill plan, calibration
 *   4. You            — profile, settings, autonomy defaults
 *   5. Approvals      — the Yellow-tier queue
 *
 * Everything downstream (left rail, bottom tabs, keyboard shortcuts, tests)
 * reads this list. Adding / removing a room requires updating it in exactly
 * one place, and the room-registry unit test guards the invariants
 * (exactly five entries, unique hrefs, unique shortcuts, valid href shape).
 */

export type RoomId = 'today' | 'opportunities' | 'plan' | 'you' | 'approvals';

export interface Room {
  /** Stable programmatic id — used as React key and in tests. */
  readonly id: RoomId;
  /** Human-readable label (English; i18n arrives with FM3). */
  readonly label: string;
  /** Route under the `(app)` group. Always a leading-slash pathname. */
  readonly href: `/${string}`;
  /** Keyboard shortcut key (with ⌘/Ctrl); one char, lowercased. */
  readonly shortcut: string;
  /** True if this room hosts an approval-count badge in the shell. */
  readonly showsApprovalsBadge?: boolean;
}

/**
 * The five rooms in display order (top→bottom on the desktop rail,
 * left→right on the mobile tab bar).
 *
 * Approvals is intentionally last so the badge lands in a predictable spot
 * whether the user is on desktop (bottom of rail) or mobile (right of tabs).
 */
export const ROOMS: readonly Room[] = Object.freeze([
  { id: 'today', label: 'Today', href: '/today', shortcut: '1' },
  { id: 'opportunities', label: 'Opportunities', href: '/opportunities', shortcut: '2' },
  { id: 'plan', label: 'Plan', href: '/plan', shortcut: '3' },
  { id: 'you', label: 'You', href: '/you', shortcut: '4' },
  {
    id: 'approvals',
    label: 'Approvals',
    href: '/approvals',
    shortcut: '5',
    showsApprovalsBadge: true,
  },
]);

/**
 * Return the room whose `href` is a prefix of the current pathname, or
 * `null` when the caller is on a non-room route (e.g. `/onboarding`).
 * Used by the shell to highlight the active nav item.
 */
export function findRoomForPath(pathname: string): Room | null {
  // Longest-match wins — future nested rooms (e.g. /plan/skills) still
  // resolve to their parent room here.
  const sorted = [...ROOMS].sort((a, b) => b.href.length - a.href.length);
  return sorted.find((r) => pathname === r.href || pathname.startsWith(`${r.href}/`)) ?? null;
}