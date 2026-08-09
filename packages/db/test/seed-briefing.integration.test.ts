import { PrismaClient } from '@prisma/client';
import {
  DEV_USER_ID,
  briefingLatestResponseSchema,
  briefingStepRecordSchema,
} from '@careeros/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaBriefingStore } from '../src/stores/prisma-briefing-store.js';

// eslint-disable-next-line no-restricted-properties
const DATABASE_URL = process.env.DATABASE_URL;
const itIfDb = DATABASE_URL ? it : it.skip;

describe('canonical dev briefing seed (live Postgres)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    if (DATABASE_URL) prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  itIfDb('matches the public latest-response contract with coherent steps', async () => {
    const persisted = await prisma.briefingRun.findFirstOrThrow({
      where: { userId: DEV_USER_ID },
      orderBy: { startedAt: 'desc' },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    const response = await new PrismaBriefingStore(prisma).latestForUser(DEV_USER_ID);
    expect(response).not.toBeNull();
    expect(briefingLatestResponseSchema.parse(response)).toEqual(response);

    const steps = response!.steps;
    for (const step of steps) expect(briefingStepRecordSchema.parse(step)).toEqual(step);

    const runStart = persisted.startedAt.getTime();
    const runFinish = persisted.finishedAt?.getTime() ?? Number.NaN;
    let previousFinish = runStart;
    for (const step of steps) {
      const parsed = briefingStepRecordSchema.parse(step);
      const startedAt = Date.parse(parsed.startedAt);
      const finishedAt = Date.parse(parsed.finishedAt);
      expect(startedAt).toBeGreaterThanOrEqual(previousFinish);
      expect(finishedAt).toBeGreaterThanOrEqual(startedAt);
      expect(startedAt).toBeGreaterThanOrEqual(runStart);
      expect(finishedAt).toBeLessThanOrEqual(runFinish);
      previousFinish = finishedAt;
    }
    expect(steps.reduce((sum, step) => sum + step.costUsd, 0)).toBeCloseTo(response!.costTotal, 10);
    expect(steps.map((step) => step.itemsProduced)).toEqual([3, 3, response!.items.length]);
    expect(response!.items).toHaveLength(3);
  });

  it('keeps the existing partial-failure step shape contract-valid', () => {
    expect(briefingStepRecordSchema.safeParse({
      name: 'research-refresh',
      status: 'failed',
      costUsd: 0,
      traceId: 'fixture-partial-failure-v1',
      startedAt: '2026-01-06T06:00:10.000Z',
      finishedAt: '2026-01-06T06:00:11.000Z',
      itemsProduced: 0,
      error: 'fixture failure',
      retryable: true,
    }).success).toBe(true);
  });
});