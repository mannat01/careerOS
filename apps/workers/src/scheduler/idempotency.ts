/**
 * M07 Step 4 — Per-(user, day) idempotency for the overnight loop.
 *
 * Acceptance criterion: a retry or duplicate trigger MUST NOT create a second
 * briefing. Concretely: if the scheduler already composed a briefing for a
 * given (userId, runDayKey), a subsequent trigger for the same key returns
 * the SAME briefing id rather than composing a new one.
 *
 * This is a narrow port (`IdempotencyStorePort`) with a Redis-backed adapter
 * pushed to the concrete boundary; the pure loop only sees the port. The
 * in-memory adapter here is the reference implementation used by unit tests +
 * the deterministic e2e run — Redis SETNX has the exact same semantics.
 */

/** The narrow contract the loop calls into. Redis SETNX-equivalent. */
export interface IdempotencyStorePort {
  /**
   * Atomically reserve `key`, associating it with `briefingRunId`. Returns
   * `true` on the FIRST caller (they should proceed with composition); returns
   * `false` on every duplicate (the caller should short-circuit and read the
   * already-composed briefing via `get`).
   *
   * A retry with the same `briefingRunId` MUST still return `false`; there is
   * no idempotent-upsert semantic here — the FIRST winner owns the day.
   */
  claim(key: string, briefingRunId: string): Promise<boolean>;
  /**
   * After the FIRST claimant finishes composition, overwrite the stored id
   * with the real BriefingRun id (the claim was made with a placeholder so
   * the SETNX gate could fire before the expensive work). MUST only be
   * called by the caller who successfully claimed the key; the adapter is
   * NOT required to enforce that (the workflow does). This is a plain SET —
   * it never gates or blocks.
   */
  finalize(key: string, briefingRunId: string): Promise<void>;
  /** Read the run id associated with a claimed key, or null if unclaimed. */
  get(key: string): Promise<string | null>;
}

/**
 * Composite key format: `briefing:{userId}:{runDayKey}`. Kept as a single
 * helper so every caller uses the same key shape and no cross-user collision
 * can occur (namespacing on `userId` is mandatory).
 */
export function briefingIdempotencyKey(userId: string, runDayKey: string): string {
  return `briefing:${userId}:${runDayKey}`;
}

/** Reference in-memory adapter — the tests use this; Redis adapter is prod. */
export class InMemoryIdempotencyStore implements IdempotencyStorePort {
  private readonly map = new Map<string, string>();

  claim(key: string, briefingRunId: string): Promise<boolean> {
    if (this.map.has(key)) return Promise.resolve(false);
    this.map.set(key, briefingRunId);
    return Promise.resolve(true);
  }

  finalize(key: string, briefingRunId: string): Promise<void> {
    this.map.set(key, briefingRunId);
    return Promise.resolve();
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.map.get(key) ?? null);
  }
}
