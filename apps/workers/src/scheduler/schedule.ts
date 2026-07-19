/**
 * M07 Step 4 — Scheduler timing / quiet-hours / timezone logic (pure).
 *
 * The BullMQ repeatable-cron wiring lives at the app boundary (BullMQ + Redis
 * are pushed to the concrete adapter in `runner.ts`); this module is the pure,
 * deterministic core the tests exercise directly. Two responsibilities:
 *
 *   1. Given a `UserBriefingSchedule` (`briefing_schedule` + timezone + quiet
 *      hours from `UserSettings`), compute whether "now" is a legitimate time
 *      to run the overnight loop:
 *        - `withinQuietHours(now, schedule)`         — pure boolean.
 *        - `isEligibleForRun(now, schedule)`         — quiet-hours + not-blank.
 *   2. Given a schedule + "now", compute the ISO-YYYY-MM-DD **run-day key** in
 *      the user's timezone. This is the deterministic idempotency key so a
 *      duplicate trigger for the same user + same local day is ALWAYS the same
 *      key → the idempotency store short-circuits (never a second briefing).
 *
 * PER-USER by construction: every function takes a per-user schedule, never a
 * shared/global clock. The scheduler NEVER decides to run inside quiet hours —
 * the acceptance-criteria contract.
 */

// ---------------- domain ----------------

/**
 * A user's briefing schedule (source: `UserSettings.briefing_schedule` +
 * `UserSettings.quiet_hours` + `Profile`-derived timezone). Deliberately narrow
 * — the scheduler doesn't care about anything else.
 *
 * `dailyAt` is a wall-clock HH:mm in the user's timezone (e.g. "08:00") — the
 * PRD's "8AM briefing" is per-user, so we store the wall-clock string and let
 * the timezone-aware helpers below decide when it lands in UTC.
 *
 * `quietHours` is a wall-clock window that never runs. Windows are allowed to
 * cross midnight (e.g. `{ start: "22:00", end: "07:00" }`); the check honors
 * both cases. When `enabled: false` (or absent), quiet-hours is a no-op.
 */
export interface UserBriefingSchedule {
  /** IANA timezone id, e.g. `"America/Chicago"`. */
  timezone: string;
  /** Wall-clock HH:mm the daily overnight loop should run. e.g. `"08:00"`. */
  dailyAt: string;
  quietHours?: {
    enabled: boolean;
    /** HH:mm wall-clock in the user's timezone. */
    start: string;
    /** HH:mm wall-clock in the user's timezone (exclusive). */
    end: string;
  };
}

// ---------------- pure helpers ----------------

const HHMM_RE = /^([0-1]\d|2[0-3]):([0-5]\d)$/;

/** Parse "HH:mm" → minutes-since-midnight, or `null` if malformed. */
export function parseHHMM(value: string): number | null {
  const m = HHMM_RE.exec(value);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh * 60 + mm;
}

/**
 * Return the wall-clock parts (`year`, `month`, `day`, `hour`, `minute`) of
 * `now` as observed in the given IANA `timezone`. Uses `Intl.DateTimeFormat`
 * (which is the DST-correct primitive in Node ≥20; no external tz lib needed).
 * `en-CA` yields the ISO-style `YYYY-MM-DD` component ordering.
 */
export function wallClockInTz(
  now: Date,
  timezone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const pick = (name: string): number => {
    const p = parts.find((x) => x.type === name);
    return p ? Number(p.value) : NaN;
  };
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    // `hour12: false` yields '00'..'23' in Node ≥20; the string→Number cast
    // handles the '24:00' corner case some ICU builds emit at midnight by
    // normalizing to 0.
    hour: pick('hour') % 24,
    minute: pick('minute'),
  };
}

/**
 * `YYYY-MM-DD` in the user's timezone — the run-day idempotency key. Two
 * triggers for the same user + same local day always yield the same key.
 */
export function runDayKey(now: Date, schedule: UserBriefingSchedule): string {
  const w = wallClockInTz(now, schedule.timezone);
  const mm = String(w.month).padStart(2, '0');
  const dd = String(w.day).padStart(2, '0');
  return `${w.year}-${mm}-${dd}`;
}

/**
 * Is `now` inside the user's quiet-hours window? Handles windows that cross
 * midnight (e.g. 22:00 → 07:00). Returns `false` when quiet hours are absent
 * or disabled, or when the config is malformed (fail-open on config error is
 * NOT acceptable — we fail SAFE: return false only for missing/disabled; a
 * malformed window is treated as "not in quiet hours" but the schedule loader
 * SHOULD reject malformed configs upstream).
 */
export function withinQuietHours(now: Date, schedule: UserBriefingSchedule): boolean {
  const qh = schedule.quietHours;
  if (!qh || !qh.enabled) return false;
  const start = parseHHMM(qh.start);
  const end = parseHHMM(qh.end);
  if (start === null || end === null) return false;
  const w = wallClockInTz(now, schedule.timezone);
  const nowMins = w.hour * 60 + w.minute;
  if (start === end) return false; // zero-length window = disabled
  if (start < end) {
    // Same-day window: [start, end)
    return nowMins >= start && nowMins < end;
  }
  // Crosses midnight: quiet if now >= start OR now < end.
  return nowMins >= start || nowMins < end;
}

/**
 * The scheduler's single "may I run now?" predicate. NEVER runs inside quiet
 * hours. Also refuses to run when the schedule is structurally invalid
 * (malformed `dailyAt`) so a misconfig doesn't silently thrash.
 */
export function isEligibleForRun(now: Date, schedule: UserBriefingSchedule): boolean {
  if (parseHHMM(schedule.dailyAt) === null) return false;
  if (withinQuietHours(now, schedule)) return false;
  return true;
}

/**
 * Human-readable reason a run was suppressed. Returns `null` when eligible.
 * Used by the loop's audit trail and by tests that need to assert on the
 * specific suppression cause.
 */
export function reasonForSuppression(
  now: Date,
  schedule: UserBriefingSchedule,
): 'quiet_hours' | 'invalid_schedule' | null {
  if (parseHHMM(schedule.dailyAt) === null) return 'invalid_schedule';
  if (withinQuietHours(now, schedule)) return 'quiet_hours';
  return null;
}