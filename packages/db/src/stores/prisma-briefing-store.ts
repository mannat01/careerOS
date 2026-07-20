import { randomUUID } from 'node:crypto';
import type { PrismaClient, BriefingTrigger, BriefingStatus, BriefingItemKind, BriefingItemState, Prisma } from '@prisma/client';

/**
 * Prisma-backed store for M05 Stage-5 Step-5 briefings (database-schema.md
 * §briefing). The apps/api handler depends on this STRUCTURALLY (its narrow
 * BriefingStorePort) so @careeros/db carries no dependency on apps/api.
 *
 * PER-USER by construction: every read is scoped by `userId`, so `getById`
 * for someone else's row returns null (surfaced as 404 upstream). The full run
 * (steps + cost + items) is captured on the row itself so the audit trail can be
 * replayed from the DB alone.
 */

export type BriefingTriggerLike = 'scheduled' | 'manual';
export type BriefingStatusLike = 'queued' | 'running' | 'partial' | 'complete' | 'failed';
export type BriefingItemKindLike =
  | 'opportunity'
  | 'tailored_resume'
  | 'draft'
  | 'prep'
  | 'gap'
  | 'note'
  | 'focus'
  | 'suggestion';
export type BriefingItemStateLike = 'proposed' | 'approved' | 'edited' | 'skipped' | 'failed';

export interface BriefingStepRecordLike {
  name: string;
  status: 'ok' | 'failed' | 'skipped';
  costUsd: number;
  traceId: string;
  startedAt: string;
  finishedAt: string;
  itemsProduced: number;
  error?: string;
  retryable?: boolean;
}

export interface BriefingItemLike {
  id: string;
  kind: BriefingItemKindLike;
  refId: string | null;
  autonomyTier: 'green' | 'yellow' | 'red';
  state: BriefingItemStateLike;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface BriefingRunLike {
  id: string;
  userId: string;
  trigger: BriefingTriggerLike;
  status: BriefingStatusLike;
  inputs: Record<string, unknown>;
  steps: BriefingStepRecordLike[];
  costTotal: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface BriefingRunDetailLike extends BriefingRunLike {
  items: BriefingItemLike[];
}

/** Narrow port the apps/api handler depends on (matches BriefingStorePort there). */
export interface BriefingStorePortShape {
  createRun(input: {
    userId: string;
    trigger: BriefingTriggerLike;
    inputs: Record<string, unknown>;
  }): Promise<BriefingRunLike>;
  finalizeRun(
    runId: string,
    input: {
      status: BriefingStatusLike;
      steps: BriefingStepRecordLike[];
      costTotal: number;
      finishedAt: string;
    },
  ): Promise<BriefingRunLike>;
  addItems(
    runId: string,
    items: Omit<BriefingItemLike, 'id' | 'createdAt'>[],
  ): Promise<BriefingItemLike[]>;
  getById(userId: string, id: string): Promise<BriefingRunDetailLike | null>;
  latestForUser(userId: string): Promise<BriefingRunDetailLike | null>;
  /** M07 — per-user scoped item lookup for the approval queue. */
  findItemOnUserRun(
    userId: string,
    runId: string,
    itemId: string,
  ): Promise<BriefingItemLike | null>;
  /** M07 — transition one item's `state` (and optionally its payload). */
  updateItemState(
    itemId: string,
    input: { state: BriefingItemStateLike; payload?: Record<string, unknown> },
  ): Promise<BriefingItemLike>;
}

interface RunRow {
  id: string;
  userId: string;
  trigger: BriefingTrigger;
  status: BriefingStatus;
  inputs: Prisma.JsonValue;
  steps: Prisma.JsonValue;
  costTotal: number;
  startedAt: Date;
  finishedAt: Date | null;
}

interface ItemRow {
  id: string;
  briefingRunId: string;
  kind: BriefingItemKind;
  refId: string | null;
  autonomyTier: string;
  state: BriefingItemState;
  payload: Prisma.JsonValue;
  createdAt: Date;
}

export class PrismaBriefingStore implements BriefingStorePortShape {
  constructor(private readonly prisma: PrismaClient) {}

  async createRun(input: {
    userId: string;
    trigger: BriefingTriggerLike;
    inputs: Record<string, unknown>;
  }): Promise<BriefingRunLike> {
    const row = await this.prisma.briefingRun.create({
      data: {
        id: randomUUID(),
        userId: input.userId,
        trigger: input.trigger,
        status: 'running',
        inputs: input.inputs as Prisma.InputJsonValue,
        steps: [],
        costTotal: 0,
      },
    });
    return this.toRun(row);
  }

  async finalizeRun(
    runId: string,
    input: {
      status: BriefingStatusLike;
      steps: BriefingStepRecordLike[];
      costTotal: number;
      finishedAt: string;
    },
  ): Promise<BriefingRunLike> {
    const row = await this.prisma.briefingRun.update({
      where: { id: runId },
      data: {
        status: input.status,
        steps: input.steps as unknown as Prisma.InputJsonValue,
        costTotal: input.costTotal,
        finishedAt: new Date(input.finishedAt),
      },
    });
    return this.toRun(row);
  }

  async addItems(
    runId: string,
    items: Omit<BriefingItemLike, 'id' | 'createdAt'>[],
  ): Promise<BriefingItemLike[]> {
    if (items.length === 0) return [];
    const created = await this.prisma.$transaction(
      items.map((i) =>
        this.prisma.briefingItem.create({
          data: {
            id: randomUUID(),
            briefingRunId: runId,
            kind: i.kind,
            refId: i.refId,
            autonomyTier: i.autonomyTier,
            state: i.state,
            payload: i.payload as Prisma.InputJsonValue,
          },
        }),
      ),
    );
    return created.map((r) => this.toItem(r));
  }

  async getById(userId: string, id: string): Promise<BriefingRunDetailLike | null> {
    const row = await this.prisma.briefingRun.findFirst({
      where: { id, userId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) return null;
    return {
      ...this.toRun(row),
      items: (row.items as unknown as ItemRow[]).map((i) => this.toItem(i)),
    };
  }

  async latestForUser(userId: string): Promise<BriefingRunDetailLike | null> {
    const row = await this.prisma.briefingRun.findFirst({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) return null;
    return {
      ...this.toRun(row),
      items: (row.items as unknown as ItemRow[]).map((i) => this.toItem(i)),
    };
  }

  /**
   * PER-USER scoped item lookup: matches on (item.id, run.id, run.userId).
   * Returns null for any mismatch — the handler surfaces null as 404 so we
   * never leak cross-user or cross-run existence.
   */
  async findItemOnUserRun(
    userId: string,
    runId: string,
    itemId: string,
  ): Promise<BriefingItemLike | null> {
    const row = await this.prisma.briefingItem.findFirst({
      where: { id: itemId, briefingRunId: runId, run: { userId } },
    });
    if (!row) return null;
    return this.toItem(row as unknown as ItemRow);
  }

  /**
   * Transition one item's `state` (approved/edited/skipped). For `edit` the
   * payload is replaced atomically alongside the state — same TX so a partial
   * write can never leave payload + state inconsistent.
   */
  async updateItemState(
    itemId: string,
    input: { state: BriefingItemStateLike; payload?: Record<string, unknown> },
  ): Promise<BriefingItemLike> {
    const data: Prisma.BriefingItemUpdateInput = { state: input.state };
    if (input.payload !== undefined) {
      data.payload = input.payload as Prisma.InputJsonValue;
    }
    const row = await this.prisma.briefingItem.update({
      where: { id: itemId },
      data,
    });
    return this.toItem(row as unknown as ItemRow);
  }

  private toRun(row: RunRow): BriefingRunLike {
    return {
      id: row.id,
      userId: row.userId,
      trigger: row.trigger,
      status: row.status,
      inputs: (row.inputs ?? {}) as Record<string, unknown>,
      steps: ((row.steps ?? []) as unknown as BriefingStepRecordLike[]) ?? [],
      costTotal: row.costTotal,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    };
  }

  private toItem(row: ItemRow): BriefingItemLike {
    return {
      id: row.id,
      kind: row.kind,
      refId: row.refId,
      autonomyTier: (row.autonomyTier as 'green' | 'yellow' | 'red') ?? 'green',
      state: row.state,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
    };
  }
}