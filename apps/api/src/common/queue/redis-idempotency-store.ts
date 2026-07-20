/**
 * M07 Step 4 (Part B) — Redis-backed adapter for the scheduler's per-(user, day)
 * idempotency contract. Semantics match the in-memory reference exactly:
 *   - claim(key, id) uses `SET NX EX` → true only for the first writer;
 *   - finalize(key, id) is a plain `SET EX` (the first writer already won);
 *   - get(key) reads the current value.
 *
 * Redis SET NX is the industry-standard primitive for exactly-once claim
 * under concurrent duplicate triggers. The 48h TTL is a safety net so a
 * crashed run can't wedge a (user, day) key forever — in normal operation
 * the day rolls over long before this fires.
 *
 * The concrete `IdempotencyStorePort` this satisfies lives in
 * `@careeros/workers` (scheduler/idempotency.ts); we do NOT re-export it,
 * we implement it structurally so the workers package stays framework-free.
 */
import { Redis } from 'ioredis';
import type { IdempotencyStorePort } from '@careeros/workers';

/** 48 hours — long enough to cover schedule-slip, short enough to auto-heal. */
export const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 48 * 60 * 60;

export class RedisIdempotencyStore implements IdempotencyStorePort {
  private readonly redis: Redis;
  private readonly ttlSeconds: number;
  private readonly owned: boolean;

  constructor(
    connection: string | Redis,
    opts: { ttlSeconds?: number } = {},
  ) {
    if (typeof connection === 'string') {
      this.redis = new Redis(connection, { maxRetriesPerRequest: null });
      this.owned = true;
    } else {
      this.redis = connection;
      this.owned = false;
    }
    this.ttlSeconds = opts.ttlSeconds ?? DEFAULT_IDEMPOTENCY_TTL_SECONDS;
  }

  async claim(key: string, briefingRunId: string): Promise<boolean> {
    // NX = only set if not exists; EX = seconds TTL. Returns 'OK' on win, null on lose.
    const res = await this.redis.set(key, briefingRunId, 'EX', this.ttlSeconds, 'NX');
    return res === 'OK';
  }

  async finalize(key: string, briefingRunId: string): Promise<void> {
    // Plain SET with TTL — the caller already won `claim`; we just overwrite
    // the placeholder id with the real BriefingRun id.
    await this.redis.set(key, briefingRunId, 'EX', this.ttlSeconds);
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  /** For tests: wipe a specific key (does NOT flush the whole store). */
  async unsafeDelete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /** Close the connection if we opened it; no-op if a Redis client was injected. */
  async close(): Promise<void> {
    if (this.owned) await this.redis.quit();
  }
}