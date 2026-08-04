'use client';

/**
 * AppShell — the outer chrome that wraps every (app) route.
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  header (banner):  brand  ·  ⌘K Twin                       │
 *   ├───────────┬────────────────────────────────────────────────┤
 *   │  left     │                                                │
 *   │  rail     │        main (role=main, id=main)               │
 *   │  (nav)    │                                                │
 *   │           │        {children}  ← the room                  │
 *   ├───────────┴────────────────────────────────────────────────┤
 *   │  bottom tabs (nav, mobile only)                            │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Accessibility invariants (asserted by axe + keyboard nav tests):
 *   - Skip link is the first focusable element and jumps to `#main`.
 *   - Header uses `role="banner"` (implicit via <header> outside <main>).
 *   - Nav landmarks are labelled (`aria-label="Primary"`) so screen readers
 *     can distinguish the desktop rail from the mobile tab bar.
 *   - The active room's link carries `aria-current="page"`.
 *   - Approvals badge is announced via visible + `sr-only` count.
 *   - Keyboard shortcuts (⌘1–5) navigate rooms, respecting form focus.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { ROOMS, findRoomForPath, type Room } from './rooms.js';
import { usePendingApprovalsCount } from './approvals-store.js';
import { TwinMount } from './TwinMount.js';
import { ToastRegion } from './ToastRegion.js';

export interface AppShellProps {
  children: ReactNode;
}

/**
 * Small pure helper — decide whether a keydown should trigger a room jump.
 * Extracted so the keyboard nav test can drive it without a full render.
 */
export function shouldConsumeRoomShortcut(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  // Check both the runtime flag and the raw attribute — jsdom does not always
  // reflect the attribute into `isContentEditable`, but real browsers do.
  if (target.isContentEditable) return false;
  const editable = target.getAttribute('contenteditable');
  if (editable !== null && editable !== 'false') return false;
  return true;
}

export function AppShell({ children }: AppShellProps): JSX.Element {
  const pathname = usePathname() ?? '/';
  const activeRoom = findRoomForPath(pathname);
  const approvalsCount = usePendingApprovalsCount();
  const router = useRouter();

  // ⌘1..5 (or Ctrl+1..5) → jump to the Nth room. Skips when a form field or
  // contenteditable element owns focus so typing "1" in an input still works.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (!shouldConsumeRoomShortcut(e.target)) return;
      const digit = Number.parseInt(e.key, 10);
      if (!Number.isFinite(digit) || digit < 1 || digit > ROOMS.length) return;
      e.preventDefault();
      const room = ROOMS[digit - 1];
      if (room) router.push(room.href);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [router]);

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      <a
        href="#main"
        className="absolute left-2 top-2 z-50 -translate-y-16 rounded-md bg-brand-base px-3 py-2 text-text-inverse focus:translate-y-0"
      >
        Skip to main content
      </a>

      <header className="border-b border-border-subtle bg-bg-elevated">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link
            href="/today"
            className="font-semibold text-text-primary"
            aria-label="CareerOS home"
          >
            CareerOS
          </Link>
          <TwinMount />
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
        {/* Desktop left rail — hidden on mobile in favour of the bottom bar. */}
        <nav
          aria-label="Primary (rail)"
          className="hidden w-56 shrink-0 md:block"
          data-testid="app-shell-rail"
        >
          <ul className="flex flex-col gap-1">
            {ROOMS.map((room) => (
              <li key={room.id}>
                <RoomLink
                  room={room}
                  active={activeRoom?.id === room.id}
                  approvalsCount={approvalsCount}
                  layout="rail"
                />
              </li>
            ))}
          </ul>
        </nav>

        <main
          id="main"
          role="main"
          // `tabIndex={0}` makes <main> a real stop in the tab order so the
          // skip link (and Tab-walk) can land on it. Screen readers still
          // announce it as a "main" landmark; the explicit tabIndex just
          // exposes it as a programmatic focus target.
          tabIndex={0}
          className="min-w-0 flex-1 pb-24 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-base md:pb-0"
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar. */}
      <nav
        aria-label="Primary (tabs)"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border-subtle bg-bg-elevated md:hidden"
        data-testid="app-shell-tabs"
      >
        <ul className="mx-auto flex max-w-6xl items-stretch justify-around">
          {ROOMS.map((room) => (
            <li key={room.id} className="flex-1">
              <RoomLink
                room={room}
                active={activeRoom?.id === room.id}
                approvalsCount={approvalsCount}
                layout="tab"
              />
            </li>
          ))}
        </ul>
      </nav>

      <ToastRegion />
    </div>
  );
}

interface RoomLinkProps {
  room: Room;
  active: boolean;
  approvalsCount: number;
  layout: 'rail' | 'tab';
}

function RoomLink({ room, active, approvalsCount, layout }: RoomLinkProps): JSX.Element {
  const base =
    layout === 'rail'
      ? 'flex items-center justify-between rounded-md px-3 py-2 text-sm'
      : 'flex flex-col items-center gap-0.5 px-2 py-2 text-xs';
  const activeClass = active
    ? 'bg-bg-base font-semibold text-text-primary'
    : 'text-text-secondary hover:text-text-primary';

  const showBadge = room.showsApprovalsBadge === true && approvalsCount > 0;

  return (
    <Link
      href={room.href}
      aria-current={active ? 'page' : undefined}
      className={`${base} ${activeClass}`}
    >
      <span>{room.label}</span>
      {room.showsApprovalsBadge === true ? (
        <span data-testid={`approvals-badge-${layout}`} className="ml-2 inline-flex items-center">
          {showBadge ? (
            <span
              aria-hidden="true"
              className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-brand-base px-1.5 text-xs font-medium text-text-inverse"
            >
              {approvalsCount}
            </span>
          ) : null}
          <span className="sr-only">{approvalsCount} pending approvals</span>
        </span>
      ) : null}
    </Link>
  );
}