/**
 * M07 Step 4 (Part B) — BullMQ + Redis wiring for the scheduled overnight
 * loop.
 *
 * Design contract:
 *   - The queue produces exactly ONE BriefingRun per (user, day). Duplicate
 *     triggers (retries, split-brain schedulers, manual re-enqueues) MUST
 *     collapse to a single briefing — guaranteed by the Redis-backed
 *     `IdempotencyStorePort` (SET NX) upstream in `runOvernightLoop`.
 *   - The pure loop (`runOvernightLoop`) does the work; this file is
 *     wiring only. All decisions (quiet-hours, budget, research→plan hook)
 *     live in the pure core so unit tests can exercise them without Redis.
 *
 * The Worker deliberately concurrency=1: with idempotency-first semantics an
 * extra worker only wastes CPU on the loser side of the SETNX race. Bumping
 * concurrency is safe (idempotency still holds) — do it when queue latency
 * becomes a bottleneck, not before.
 */
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import type {
  IdempotencyStorePort,
  OvernightLoopDeps,
  OvernightLoopInput,
  OvernightLoopResult,
} from '@careeros/workers';
import { runOvernightLoop } from '@careeros/workers';

export const BRIEFING_QUEUE_NAME = 'briefing-scheduler';

export interface BriefingSchedulerJob {
  userId: string;
  subscriptionTier: 'free' | 'pro';
  scheduledForIso: string;
  timezone: string;
  /** HH:mm wall-clock in the user's timezone; also runs the schedule.dailyAt slot. */
  dailyAt: string;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  traceId: string;
}

interface RedisConn {
  host: string;
  port: number;
}

function parseRedisUrl(url: string): RedisConn {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
  };
}

/**
 * Injectable boundary for enqueuing a scheduled briefing. In production the
 * repeatable-cron entry is created ONCE at boot; ad-hoc triggers (e.g. from
 * tests, or from a manual "run now" admin path) use `enqueueOnce`.
 */
export class BriefingSchedulerQueue {
  private readonly queue: Queue<BriefingSchedulerJob>;
  private readonly owned: boolean;
  private readonly connection: Redis;

  constructor(redisUrl: string | Redis) {
    if (typeof redisUrl === 'string') {
      this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
      this.owned = true;
    } else {
      this.connection = redisUrl;
      this.owned = false;
    }
    this.queue = new Queue<BriefingSchedulerJob>(BRIEFING_QUEUE_NAME, {
      connection: this.connection,
    });
  }

  /**
   * Enqueue a single briefing trigger. Callers MAY pass a `jobId` to make
   * enqueue itself idempotent at the BullMQ layer (a second add with the
   * same id is a no-op). Even without it, the downstream `IdempotencyStore`
   * still guarantees exactly-one BriefingRun per (user, day).
   */
  async enqueueOnce(
    job: BriefingSchedulerJob,
    opts: JobsOptions = {},
  ): Promise<{ jobId: string }> {
    const added = await this.queue.add('run', job, {
      removeOnComplete: 100,
      removeOnFail: 500,
      ...opts,
    });
    return { jobId: added.id ?? 'unknown' };
  }

  /** For tests: peek at queued job count. */
  async waitingCount(): Promise<number> {
    return this.queue.getWaitingCount();
  }

  async drain(): Promise<void> {
    await this.queue.obliterate({ force: true });
  }

  async close(): Promise<void> {
    await this.queue.close();
    if (this.owned) await this.connection.quit();
  }
}

/**
 * Wire a BullMQ Worker over the pure `runOvernightLoop`. The worker itself
 * owns no business logic — it decodes the BullMQ job, hands it to the loop,
 * and awaits the (never-throwing) result. Callers are expected to construct
 * `loopDeps` in the composition root (bootstrap.ts) with the LIVE composer
 * adapter + the Redis-backed IdempotencyStore.
 */
export function createBriefingSchedulerWorker(
  redisUrl: string | Redis,
  loopDeps: OvernightLoopDeps,
  idempotency: IdempotencyStorePort,
  opts: { concurrency?: number; now?: () => Date } = {},
): Worker<BriefingSchedulerJob, OvernightLoopResult> {
  const connection =
    typeof redisUrl === 'string'
      ? new Redis(redisUrl, { maxRetriesPerRequest: null })
      : redisUrl;

  const now = opts.now ?? (() => new Date());

  return new Worker<BriefingSchedulerJob, OvernightLoopResult>(
    BRIEFING_QUEUE_NAME,
    async (job) => {
      const data = job.data;
      const loopInput: OvernightLoopInput = {
        userId: data.userId,
        subscriptionTier: data.subscriptionTier,
        schedule: {
          timezone: data.timezone,
          dailyAt: data.dailyAt,
          quietHours: {
            enabled: data.quietHoursEnabled,
            start: data.quietHoursStart,
            end: data.quietHoursEnd,
          },
        },
        now: now(),
        traceId: data.traceId,
      };
      return runOvernightLoop(loopInput, { ...loopDeps, idempotency });
    },
    {
      connection,
      concurrency: opts.concurrency ?? 1,
    },
  );
}

// Re-export the connection helper so composition roots can share one Redis client.
export { parseRedisUrl };