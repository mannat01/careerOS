/**
 * Room registry integrity tests.
 *
 * These invariants protect the shell from silent regressions when new rooms
 * are added or existing ones renamed. If any of these fail, the AppShell,
 * the ⌘K Twin, keyboard shortcuts, and downstream product analytics will
 * disagree with each other — so we lock them at the registry.
 */
import { describe, expect, it } from 'vitest';
import { findRoomForPath, ROOMS, type Room } from './rooms';

describe('ROOMS registry', () => {
  it('exposes exactly the five product rooms in canonical order', () => {
    expect(ROOMS.map((r) => r.id)).toEqual([
      'today',
      'opportunities',
      'plan',
      'you',
      'approvals',
    ]);
  });

  it('is a frozen readonly list to prevent accidental mutation at runtime', () => {
    expect(Object.isFrozen(ROOMS)).toBe(true);
    // Attempting to mutate should not silently succeed.
    expect(() => {
      (ROOMS as unknown as Room[]).push({
        id: 'today',
        label: 'x',
        href: '/x',
        shortcut: '9',
      });
    }).toThrow();
  });

  it('gives every room a unique id, href and shortcut', () => {
    const ids = new Set(ROOMS.map((r) => r.id));
    const hrefs = new Set(ROOMS.map((r) => r.href));
    const shortcuts = new Set(ROOMS.map((r) => r.shortcut));
    expect(ids.size).toBe(ROOMS.length);
    expect(hrefs.size).toBe(ROOMS.length);
    expect(shortcuts.size).toBe(ROOMS.length);
  });

  it('uses valid /-prefixed pathnames for every href', () => {
    for (const room of ROOMS) {
      expect(room.href.startsWith('/')).toBe(true);
      expect(room.href).not.toMatch(/\s/);
    }
  });

  it('flags exactly one room as the approvals-badge host', () => {
    const withBadge = ROOMS.filter((r) => r.showsApprovalsBadge === true);
    expect(withBadge).toHaveLength(1);
    expect(withBadge[0]?.id).toBe('approvals');
  });
});

describe('findRoomForPath', () => {
  it('returns the exact-match room', () => {
    expect(findRoomForPath('/today')?.id).toBe('today');
    expect(findRoomForPath('/opportunities')?.id).toBe('opportunities');
    expect(findRoomForPath('/plan')?.id).toBe('plan');
    expect(findRoomForPath('/you')?.id).toBe('you');
    expect(findRoomForPath('/approvals')?.id).toBe('approvals');
  });

  it('resolves nested paths to their parent room (longest-match)', () => {
    expect(findRoomForPath('/plan/skills/react')?.id).toBe('plan');
    expect(findRoomForPath('/opportunities/abc-123')?.id).toBe('opportunities');
  });

  it('returns null for non-room routes', () => {
    expect(findRoomForPath('/onboarding')).toBeNull();
    expect(findRoomForPath('/sign-in')).toBeNull();
    expect(findRoomForPath('/')).toBeNull();
  });

  it('does not treat a room href as a prefix of an unrelated route', () => {
    // '/youtube' must not match the '/you' room.
    expect(findRoomForPath('/youtube')).toBeNull();
    expect(findRoomForPath('/planner')).toBeNull();
  });
});