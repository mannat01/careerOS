/**
 * AppShell tests — cover the accessibility + keyboard-nav invariants that the
 * FM1 work order calls out for the shell:
 *
 *   1. axe passes on the rendered shell for every placeholder room (Today,
 *      Opportunities, Plan, You, Approvals).
 *   2. Skip link is the first focusable element and moves focus to <main>.
 *   3. Tab order flows through the primary nav and lands on the main content
 *      without any tabbable "trap" in the header.
 *   4. ⌘/Ctrl + 1..5 route to the matching room; the same shortcut inside a
 *      form field is *not* consumed (users can still type "1" in an input).
 *   5. The approvals badge is store-wired: hidden at count=0, visible + a11y
 *      announced at count>0.
 *
 * The suite mocks `next/link`, `next/navigation`, and the shell's small
 * satellite modules (approvals store, TwinMount, ToastRegion) so it can run
 * under jsdom without booting Next.js.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { ReactNode } from 'react';

// --- Mocks (must be declared before importing the SUT) -----------------------

const pushMock = vi.fn();
let currentPath = '/today';

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => currentPath,
  useRouter: () => ({ push: pushMock, replace: pushMock, prefetch: vi.fn() }),
}));

let approvalsCount = 0;
vi.mock('./approvals-store', () => ({
  usePendingApprovalsCount: () => approvalsCount,
}));

vi.mock('./TwinMount', () => ({
  TwinMount: () => <div data-testid="twin-mount" aria-hidden="true" />,
}));

vi.mock('./ToastRegion', () => ({
  ToastRegion: () => <div data-testid="toast-region" role="status" aria-live="polite" />,
}));

// Placeholder-room contents (copied to plain strings — the real pages live in
// app/(app)/*/page.tsx and are exercised separately by the axe assertions).
import { AppShell, shouldConsumeRoomShortcut } from './AppShell';

interface RoomFixture {
  path: string;
  name: string;
  content: ReactNode;
}

const ROOM_FIXTURES: readonly RoomFixture[] = [
  {
    path: '/today',
    name: 'Today',
    content: (
      <section>
        <h1>Today</h1>
        <p>Your daily focus lands here.</p>
      </section>
    ),
  },
  {
    path: '/opportunities',
    name: 'Opportunities',
    content: (
      <section aria-labelledby="opps-h">
        <h1 id="opps-h">Opportunities</h1>
        <p>No opportunities yet.</p>
      </section>
    ),
  },
  {
    path: '/plan',
    name: 'Plan',
    content: (
      <section aria-labelledby="plan-h">
        <h1 id="plan-h">Plan</h1>
        <p>No plan yet.</p>
      </section>
    ),
  },
  {
    path: '/you',
    name: 'You',
    content: (
      <section aria-labelledby="you-h">
        <h1 id="you-h">You</h1>
        <p>Your profile lives here.</p>
      </section>
    ),
  },
  {
    path: '/approvals',
    name: 'Approvals',
    content: (
      <section aria-labelledby="app-h">
        <h1 id="app-h">Approvals</h1>
        <p>No approvals pending.</p>
      </section>
    ),
  },
];

beforeEach(() => {
  pushMock.mockClear();
  approvalsCount = 0;
  currentPath = '/today';
});

afterEach(() => {
  cleanup();
});

// --- Pure helper -------------------------------------------------------------

describe('shouldConsumeRoomShortcut', () => {
  it('consumes when the target is not an editable control', () => {
    expect(shouldConsumeRoomShortcut(document.body)).toBe(true);
    expect(shouldConsumeRoomShortcut(null)).toBe(true);
  });

  it('does not consume when an input/textarea/select owns focus', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    expect(shouldConsumeRoomShortcut(input)).toBe(false);
    expect(shouldConsumeRoomShortcut(textarea)).toBe(false);
    expect(shouldConsumeRoomShortcut(select)).toBe(false);
  });

  it('does not consume when a contenteditable element owns focus', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    // jsdom respects the attribute for isContentEditable.
    expect(shouldConsumeRoomShortcut(el)).toBe(false);
  });
});

// --- Axe across every placeholder room ---------------------------------------

describe('AppShell — accessibility (axe)', () => {
  for (const room of ROOM_FIXTURES) {
    it(`has no axe violations on the ${room.name} room`, async () => {
      currentPath = room.path;
      const { container } = render(<AppShell>{room.content}</AppShell>);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  }
});

// --- Keyboard-only navigation ------------------------------------------------

describe('AppShell — keyboard navigation', () => {
  it('exposes a skip link as the first focusable element pointing at #main', async () => {
    currentPath = '/today';
    const user = userEvent.setup();
    render(<AppShell>{ROOM_FIXTURES[0]!.content}</AppShell>);

    await user.tab();
    const skip = screen.getByText(/skip to main content/i);
    expect(skip).toHaveFocus();
    expect(skip.getAttribute('href')).toBe('#main');
  });

  it('can Tab from the skip link through the nav into main without a trap', async () => {
    currentPath = '/today';
    const user = userEvent.setup();
    render(<AppShell>{ROOM_FIXTURES[0]!.content}</AppShell>);

    // Walk up to 20 tabs; we expect to reach <main> comfortably before that.
    let reachedMain = false;
    for (let i = 0; i < 20; i += 1) {
      await user.tab();
      const active = document.activeElement;
      if (active && (active.id === 'main' || active.closest('#main') !== null)) {
        reachedMain = true;
        break;
      }
    }
    expect(reachedMain).toBe(true);
  });

  it('⌘/Ctrl + digit routes to the matching room', async () => {
    currentPath = '/today';
    const user = userEvent.setup();
    render(<AppShell>{ROOM_FIXTURES[0]!.content}</AppShell>);

    await user.keyboard('{Meta>}2{/Meta}');
    expect(pushMock).toHaveBeenLastCalledWith('/opportunities');

    await user.keyboard('{Control>}5{/Control}');
    expect(pushMock).toHaveBeenLastCalledWith('/approvals');
  });

  it('ignores the shortcut when a text input owns focus', async () => {
    currentPath = '/today';
    const user = userEvent.setup();
    render(
      <AppShell>
        <input aria-label="search" />
      </AppShell>,
    );

    const input = screen.getByLabelText('search');
    input.focus();
    await user.keyboard('{Meta>}3{/Meta}');
    expect(pushMock).not.toHaveBeenCalled();
  });
});

// --- Approvals badge ---------------------------------------------------------

describe('AppShell — approvals badge', () => {
  it('renders the badge slot but no visible count when there are 0 approvals', () => {
    approvalsCount = 0;
    currentPath = '/today';
    render(<AppShell>{ROOM_FIXTURES[0]!.content}</AppShell>);

    // Slot exists (once per layout — desktop rail + mobile tabs both render
    // it in the DOM; visibility is controlled by CSS media queries).
    const slots = screen.getAllByTestId(/^approvals-badge-/);
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.textContent).toMatch(/0 pending approvals/);
      // No numeric pill rendered at count=0.
      expect(slot.querySelector('[aria-hidden="true"]')).toBeNull();
    }
  });

  it('renders the numeric pill and announces the count when > 0', () => {
    approvalsCount = 4;
    currentPath = '/today';
    render(<AppShell>{ROOM_FIXTURES[0]!.content}</AppShell>);

    const slots = screen.getAllByTestId(/^approvals-badge-/);
    for (const slot of slots) {
      const pill = slot.querySelector('[aria-hidden="true"]');
      expect(pill).not.toBeNull();
      expect(pill?.textContent).toBe('4');
      expect(slot.textContent).toMatch(/4 pending approvals/);
    }
  });
});

// --- Landmarks / active room -------------------------------------------------

describe('AppShell — landmarks and active room', () => {
  it('marks the current room link with aria-current="page"', () => {
    currentPath = '/plan';
    render(<AppShell>{ROOM_FIXTURES[2]!.content}</AppShell>);

    // Two nav landmarks (rail + tabs) render the same set of links; both
    // matching Plan links should be aria-current.
    const planLinks = screen.getAllByRole('link', { name: /^plan$/i });
    expect(planLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of planLinks) {
      expect(link).toHaveAttribute('aria-current', 'page');
    }
  });

  it('renders both primary navs with an accessible name', () => {
    currentPath = '/today';
    render(<AppShell>{ROOM_FIXTURES[0]!.content}</AppShell>);
    const navs = screen.getAllByRole('navigation', { name: /primary/i });
    // One for the desktop rail, one for the mobile tab bar.
    expect(navs.length).toBe(2);
  });
});