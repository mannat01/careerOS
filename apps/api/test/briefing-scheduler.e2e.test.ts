/**
 * ⚑ M07 Step 4 (Part B) — scheduler infra e2e over REAL BullMQ + Redis.
 *
 * Closes the Step-4 gap: proves the docker-Redis-backed queue + idempotency
 * store deliver the acceptance criteria under wire semantics, not just in
 * unit-test mocks:
 *
 *   1. A BullMQ trigger (repeatable schedule or ad-hoc `enqueueOnce`)
 *      actually reaches the worker and composes a BriefingRun exactly once.
 *   2. Redis-backed idempotency (SET NX EX) holds under CONCURRENT duplicate
 *      triggers — a burst of N enqueues for the same (user, day) → exactly
 *      ONE composer invocation.
 *   3. Research→plan hook fires on HIGH-impact findings; the diff is
 *      captured by the regenerator port (which the app-side adapter
 *      persists — pinned separately by unit tests around the store).
 *   4. Quiet-hours suppression holds with the REAL scheduler: an out-of-hours
 *      trigger yields `{ suppressed: 'quiet_hours' }` and the composer is
 *      never called (even though the queue delivered the job).
 *
 * DB/LLM side-effects are stubbed at the composer/regenerator ports (the
 * `briefing.e2e.test.ts` already pins full Prisma persistence); this test
 * exists to pin the *scheduler infrastructure* end of the pipeline where
 * only real Redis semantics can prove correctness (SETNX under concurrency).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import type {
  AuditPort,
  BriefingComposerPort,
  ComposedBriefing,
  OvernightLoopDeps,
  PlanRegeneratorPort,
  ResearchFindingLike,
  ResearchFindingReadPort,
} from '@careeros/workers';
import {
  BRIEFING_QUEUE_NAME,
  BriefingSchedulerQueue,
  createBriefingSchedulerWorker,
  RedisIdempotencyStore,
} from '../src/index.js';

// ------------ real docker Redis ------------
// eslint-disable-next-line no-restricted-properties
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

// ------------ helpers ------------

const CHICAGO_TZ = 'America/Chicago';
const DAILY_AT = '08:00';
const QUIET_START = '22:00';
const QUIET_END = '07:00';

// 08:00 CDT July 19 → 13:00 UTC (outside quiet window; eligible).
const DAYTIME = new Date(Date.UTC(2026, 6, 19, 13, 0, 0));
// 01:00 CDT July 19 → 06:00 UTC (INSIDE cross-midnight quiet window).
const NIGHTTIME = new Date(Date.UTC(2026, 6, 19, 6, 0, 0));

const HIGH_FINDING: ResearchFindingLike = {
  id: 'f-high',
  impact: 'high',
  summary: 'Major hiring surge for the target role.',
};

function makeComposer(
  outcome: Partial<ComposedBriefing> = {},
): { port: BriefingComposerPort; calls: Array<{ userId: string; runDayKey: string }> } {
  const calls: Array<{ userId: string; runDayKey: string }> = [];
  const port: BriefingComposerPort = {
    compose: async (input) => {
      calls.push({ userId: input.userId, runDayKey: input.runDayKey });
      // Simulate real composition latency so the SETNX race actually races.
      await new Promise((r) => setTimeout(r, 25));
      return {
        briefingRunId: `br-${input.userId}-${input.runDayKey}`,
        status: 'complete',
        itemCount: 3,
        costUsd: 0.05,
        steps: [
          { name: 'refresh-context', status: 'ok', costUsd: 0.01, itemsProduced: 1 },
          { name: 'score-opps', status: 'ok', costUsd: 0.02, itemsProduced: 1 },
          { name: 'compose', status: 'ok', costUsd: 0.02, itemsProduced: 1 },
        ],
        ...outcome,
      };
    },
  };
  return { port, calls };
}

function makeResearch(findings: ResearchFindingLike[]): ResearchFindingReadPort {
  return { listRecentFindingsAffectingUser: () => Promise.resolve(findings) };
}

function makeRegenerator(): {
  port: PlanRegeneratorPort;
  calls: Array<{ userId: string; changeType: string; impact?: string; diffSummary: string }>;
} {
  const calls: Array<{ userId: string; changeType: string; impact?: string; diffSummary: string }> = [];
  const port: PlanRegeneratorPort = {
    // eslint-disable-next-line @typescript-eslint/require-await
    regenerate: async (input) => {
      const impact =
        input.change.type === 'research-finding' ? input.change.impact : undefined;
      const diffSummary = `Regenerated for ${input.change.type}`;
      calls.push({
        userId: input.userId,
        changeType: input.change.type,
        ...(impact ? { impact } : {}),
        diffSummary,
      });
      return { regenerated: true, diffSummary, planId: `plan-${calls.length}` };
    },
  };
  return { port, calls };
}

function makeAudit(): { port: AuditPort; entries: Array<{ action: string; reason: string }> } {
  const entries: Array<{ action: string; reason: string }> = [];
  return {
    port: {
      // eslint-disable-next-line @typescript-eslint/require-await
      append: async ({ action, reason }) => {
        entries.push({ action, reason });
      },
    },
    entries,
  };
}

// ------------ suite ------------

describe('scheduler infra e2e — real BullMQ + Redis', () => {
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
    await redis.connect();
    // sanity: does docker Redis answer?
    await redis.ping();
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    // Blow away any leftover BullMQ / idempotency keys from prior runs.
    const scanAndDel = async (pattern: string): Promise<void> => {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) await redis.del(...keys);
    };
    await scanAndDel(`bull:${BRIEFING_QUEUE_NAME}:*`);
    await scanAndDel('briefing:*');
  });

  it('trigger reaches worker → composer produces one BriefingRun', async () => {
    const composer = makeComposer();
    const regen = makeRegenerator();
    const audit = makeAudit();
    const idempotency = new RedisIdempotencyStore(redis, { ttlSeconds: 60 });
    const loopDeps: OvernightLoopDeps = {
      composer: composer.port,
      research: makeResearch([]),
      planRegenerator: regen.port,
      idempotency,
      audit: audit.port,
    };
    const queue = new BriefingSchedulerQueue(REDIS_URL);
    const worker = createBriefingSchedulerWorker(REDIS_URL, loopDeps, idempotency, {
      now: () => DAYTIME,
    });

    const done = new Promise<void>((resolve, reject) => {
      worker.on('completed', () => resolve());
      worker.on('failed', (_job: unknown, err: Error) => reject(err));
    });

    await queue.enqueueOnce({
      userId: 'user-single',
      subscriptionTier: 'free',
      scheduledForIso: DAYTIME.toISOString(),
      timezone: CHICAGO_TZ,
      dailyAt: DAILY_AT,
      quietHoursEnabled: true,
      quietHoursStart: QUIET_START,
      quietHoursEnd: QUIET_END,
      traceId: 'trace-e2e-single',
    });

    await done;

    expect(composer.calls).toHaveLength(1);
    expect(composer.calls[0]).toMatchObject({ userId: 'user-single' });

    await worker.close();
    await queue.close();
  }, 15_000);

  it('concurrent duplicate triggers for same (user, day) → EXACTLY ONE briefing', async () => {
    const composer = makeComposer();
    const regen = makeRegenerator();
    const audit = makeAudit();
    const idempotency = new RedisIdempotencyStore(redis, { ttlSeconds: 60 });
    const loopDeps: OvernightLoopDeps = {
      composer: composer.port,
      research: makeResearch([]),
      planRegenerator: regen.port,
      idempotency,
      audit: audit.port,
    };
    const queue = new BriefingSchedulerQueue(REDIS_URL);
    // Concurrency=5 to REALLY race the SETNX — even parallel workers must
    // still yield a single composer call. That's the acceptance contract.
    const worker = createBriefingSchedulerWorker(REDIS_URL, loopDeps, idempotency, {
      now: () => DAYTIME,
      concurrency: 5,
    });

    const N = 8;
    // Fail-fast on any worker error so the outer wait doesn't hang the suite.
    const failed = new Promise<void>((_, reject) => {
      worker.on('failed', (_job: unknown, err: Error) => reject(err));
    });

    // Fire the duplicates AS CONCURRENTLY AS POSSIBLE — no awaits between adds.
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        queue.enqueueOnce({
          userId: 'user-race',
          subscriptionTier: 'free',
          scheduledForIso: DAYTIME.toISOString(),
          timezone: CHICAGO_TZ,
          dailyAt: DAILY_AT,
          quietHoursEnabled: true,
          quietHoursStart: QUIET_START,
          quietHoursEnd: QUIET_END,
          traceId: `trace-race-${i}`,
        }),
      ),
    );

    // Wait for all N to be processed.
    const allDone = new Promise<void>((resolve) => {
      let seen = 0;
      const onDone = (): void => {
        seen++;
        if (seen === N) {
          worker.off('completed', onDone);
          resolve();
        }
      };
      worker.on('completed', onDone);
    });
    await Promise.race([allDone, failed]);

    // ⚑ Exactly-one BriefingRun for the (user, day). Every loser saw the
    // SETNX return null and short-circuited to `duplicate` — composer was
    // NEVER invoked on those paths.
    expect(composer.calls).toHaveLength(1);
    expect(composer.calls[0]?.userId).toBe('user-race');

    await worker.close();
    await queue.close();
  }, 20_000);

  it('research→plan hook regenerates on HIGH-impact finding; diff is captured', async () => {
    const composer = makeComposer();
    const regen = makeRegenerator();
    const audit = makeAudit();
    const idempotency = new RedisIdempotencyStore(redis, { ttlSeconds: 60 });
    const loopDeps: OvernightLoopDeps = {
      composer: composer.port,
      research: makeResearch([HIGH_FINDING]),
      planRegenerator: regen.port,
      idempotency,
      audit: audit.port,
    };
    const queue = new BriefingSchedulerQueue(REDIS_URL);
    const worker = createBriefingSchedulerWorker(REDIS_URL, loopDeps, idempotency, {
      now: () => DAYTIME,
    });

    const done = new Promise<void>((resolve, reject) => {
      worker.on('completed', () => resolve());
      worker.on('failed', (_job: unknown, err: Error) => reject(err));
    });

    await queue.enqueueOnce({
      userId: 'user-hook',
      subscriptionTier: 'free',
      scheduledForIso: DAYTIME.toISOString(),
      timezone: CHICAGO_TZ,
      dailyAt: DAILY_AT,
      quietHoursEnabled: true,
      quietHoursStart: QUIET_START,
      quietHoursEnd: QUIET_END,
      traceId: 'trace-hook',
    });

    await done;

    expect(composer.calls).toHaveLength(1);
    expect(regen.calls).toHaveLength(1);
    expect(regen.calls[0]).toMatchObject({
      userId: 'user-hook',
      changeType: 'research-finding',
      impact: 'high',
    });
    expect(regen.calls[0]?.diffSummary).toContain('Regenerated');

    await worker.close();
    await queue.close();
  }, 15_000);

  it('quiet-hours suppression holds with real scheduler; composer is NEVER called', async () => {
    const composer = makeComposer();
    const regen = makeRegenerator();
    const audit = makeAudit();
    const idempotency = new RedisIdempotencyStore(redis, { ttlSeconds: 60 });
    const loopDeps: OvernightLoopDeps = {
      composer: composer.port,
      research: makeResearch([HIGH_FINDING]),
      planRegenerator: regen.port,
      idempotency,
      audit: audit.port,
    };
    const queue = new BriefingSchedulerQueue(REDIS_URL);
    const worker = createBriefingSchedulerWorker(REDIS_URL, loopDeps, idempotency, {
      now: () => NIGHTTIME, // inside quiet hours
    });

    const done = new Promise<void>((resolve, reject) => {
      worker.on('completed', () => resolve());
      worker.on('failed', (_job: unknown, err: Error) => reject(err));
    });

    await queue.enqueueOnce({
      userId: 'user-quiet',
      subscriptionTier: 'free',
      scheduledForIso: NIGHTTIME.toISOString(),
      timezone: CHICAGO_TZ,
      dailyAt: DAILY_AT,
      quietHoursEnabled: true,
      quietHoursStart: QUIET_START,
      quietHoursEnd: QUIET_END,
      traceId: 'trace-quiet',
    });

    await done;

    expect(composer.calls).toHaveLength(0);
    expect(regen.calls).toHaveLength(0);
    expect(audit.entries.some((e) => e.action.includes('suppressed'))).toBe(true);

    await worker.close();
    await queue.close();
  }, 15_000);
});