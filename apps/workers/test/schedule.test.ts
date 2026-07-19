/**
 * M07 Step 4 — Scheduler timing / quiet-hours unit tests.
 *
 * The scheduler NEVER runs inside quiet hours (acceptance criterion). These
 * tests pin quiet-hours behavior across:
 *   - same-day windows (08:00 → 20:00)
 *   - cross-midnight windows (22:00 → 07:00) — the common overnight case
 *   - disabled / absent quiet-hours (no suppression)
 *   - invalid `dailyAt` (schedule refuses to run — surfaces as suppression)
 *   - `runDayKey` stability across timezone shifts (idempotency depends on it)
 */
import { describe, expect, it } from 'vitest';
import {
  isEligibleForRun,
  parseHHMM,
  reasonForSuppression,
  runDayKey,
  wallClockInTz,
  withinQuietHours,
  type UserBriefingSchedule,
} from '../src/scheduler/schedule.js';

const CHICAGO: UserBriefingSchedule = {
  timezone: 'America/Chicago',
  dailyAt: '08:00',
  quietHours: { enabled: true, start: '22:00', end: '07:00' },
};

const NO_QH: UserBriefingSchedule = {
  timezone: 'America/Chicago',
  dailyAt: '08:00',
};

describe('parseHHMM', () => {
  it('parses valid HH:mm', () => {
    expect(parseHHMM('00:00')).toBe(0);
    expect(parseHHMM('08:30')).toBe(510);
    expect(parseHHMM('23:59')).toBe(1439);
  });
  it('rejects invalid', () => {
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('8:00')).toBeNull(); // needs zero-padding
    expect(parseHHMM('nope')).toBeNull();
    expect(parseHHMM('')).toBeNull();
  });
});

describe('wallClockInTz', () => {
  it('projects a UTC instant into the target timezone', () => {
    // 2026-07-19T12:00:00Z is 07:00 in America/Chicago (CDT, UTC-5).
    const t = new Date(Date.UTC(2026, 6, 19, 12, 0, 0));
    const w = wallClockInTz(t, 'America/Chicago');
    expect(w).toEqual({ year: 2026, month: 7, day: 19, hour: 7, minute: 0 });
  });
});

describe('withinQuietHours (cross-midnight window 22:00 → 07:00)', () => {
  const insideNight = new Date(Date.UTC(2026, 6, 19, 6, 0, 0)); // 01:00 CDT
  const insideMorning = new Date(Date.UTC(2026, 6, 19, 11, 30, 0)); // 06:30 CDT
  const rightAtEnd = new Date(Date.UTC(2026, 6, 19, 12, 0, 0)); // 07:00 CDT (exclusive)
  const daytime = new Date(Date.UTC(2026, 6, 19, 15, 0, 0)); // 10:00 CDT

  it('is quiet during the cross-midnight window', () => {
    expect(withinQuietHours(insideNight, CHICAGO)).toBe(true);
    expect(withinQuietHours(insideMorning, CHICAGO)).toBe(true);
  });
  it('is NOT quiet at/after the exclusive end', () => {
    expect(withinQuietHours(rightAtEnd, CHICAGO)).toBe(false);
    expect(withinQuietHours(daytime, CHICAGO)).toBe(false);
  });
});

describe('withinQuietHours (same-day window 08:00 → 20:00)', () => {
  const sameDay: UserBriefingSchedule = {
    timezone: 'America/Chicago',
    dailyAt: '05:00',
    quietHours: { enabled: true, start: '08:00', end: '20:00' },
  };
  it('is quiet inside the window', () => {
    const t = new Date(Date.UTC(2026, 6, 19, 20, 0, 0)); // 15:00 CDT
    expect(withinQuietHours(t, sameDay)).toBe(true);
  });
  it('is NOT quiet outside the window', () => {
    const t = new Date(Date.UTC(2026, 6, 19, 6, 0, 0)); // 01:00 CDT
    expect(withinQuietHours(t, sameDay)).toBe(false);
  });
});

describe('withinQuietHours (disabled / absent)', () => {
  it('returns false when quiet-hours is absent', () => {
    const t = new Date(Date.UTC(2026, 6, 19, 6, 0, 0));
    expect(withinQuietHours(t, NO_QH)).toBe(false);
  });
  it('returns false when quiet-hours is explicitly disabled', () => {
    const s: UserBriefingSchedule = {
      ...CHICAGO,
      quietHours: { enabled: false, start: '22:00', end: '07:00' },
    };
    const t = new Date(Date.UTC(2026, 6, 19, 6, 0, 0));
    expect(withinQuietHours(t, s)).toBe(false);
  });
});

describe('isEligibleForRun', () => {
  it('refuses to run during quiet hours', () => {
    const t = new Date(Date.UTC(2026, 6, 19, 6, 0, 0)); // 01:00 CDT
    expect(isEligibleForRun(t, CHICAGO)).toBe(false);
    expect(reasonForSuppression(t, CHICAGO)).toBe('quiet_hours');
  });
  it('runs outside quiet hours', () => {
    const t = new Date(Date.UTC(2026, 6, 19, 13, 0, 0)); // 08:00 CDT
    expect(isEligibleForRun(t, CHICAGO)).toBe(true);
    expect(reasonForSuppression(t, CHICAGO)).toBeNull();
  });
  it('refuses to run on a malformed dailyAt (fails safe)', () => {
    const bad: UserBriefingSchedule = { ...NO_QH, dailyAt: '8:00' };
    const t = new Date(Date.UTC(2026, 6, 19, 13, 0, 0));
    expect(isEligibleForRun(t, bad)).toBe(false);
    expect(reasonForSuppression(t, bad)).toBe('invalid_schedule');
  });
});

describe('runDayKey', () => {
  it('is stable per user-local calendar day', () => {
    // 06:00 UTC = 01:00 CDT (still July 19 in Chicago) → key = 2026-07-19.
    const early = new Date(Date.UTC(2026, 6, 19, 6, 0, 0));
    // 04:00 UTC July 20 = 23:00 CDT July 19 → same local day.
    const lateSameDay = new Date(Date.UTC(2026, 6, 20, 4, 0, 0));
    expect(runDayKey(early, CHICAGO)).toBe('2026-07-19');
    expect(runDayKey(lateSameDay, CHICAGO)).toBe('2026-07-19');
  });
  it('rolls over at local midnight, not UTC midnight', () => {
    // 05:00 UTC July 20 = 00:00 CDT July 20 → new local day.
    const localMidnight = new Date(Date.UTC(2026, 6, 20, 5, 0, 0));
    expect(runDayKey(localMidnight, CHICAGO)).toBe('2026-07-20');
  });
});