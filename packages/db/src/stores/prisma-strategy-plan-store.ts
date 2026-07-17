import { randomUUID } from 'node:crypto';
import type {
  PrismaClient,
  Prisma,
  StrategyPlanHorizon,
  StrategyPlanStatus,
  PlanActionKind,
  PlanActionStatus,
} from '@prisma/client';

/**
 * Prisma-backed store for the M06 Strategy Plans (database-schema.md §cie). The
 * apps/api handler depends on this STRUCTURALLY (its narrow StrategyPlanStorePort)
 * so @careeros/db carries no dependency on apps/api.
 *
 * PER-USER by construction: every read/write is scoped by `userId`, so a caller
 * can neither read nor mutate another user's plans — a lookup for someone else's
 * row returns null.
 *
 * ONE ACTIVE PLAN PER HORIZON: enforced by a PARTIAL unique index
 * `(user_id, horizon) WHERE status='active'`. Regeneration SUPERSEDES: within one
 * transaction the prior active plan flips to `superseded` (and points forward via
 * `superseded_by_id`) BEFORE the replacement is inserted, so the partial-unique
 * invariant never trips. The store never decides WHETHER to regenerate — that
 * §4A discipline lives in the pure planner guardrail the handler runs first; the
 * store just persists what the handler already authorized.
 */

// ---- structural shapes mirroring the apps/api handler port (by value, no import) ----

export type PlanHorizonLike = '30d' | '90d' | '1y' | '3y' | '5y';
export type PlanStatusLike = 'active' | 'superseded';
export type PlanActionKindLike = 'skill' | 'project' | 'cert' | 'role' | 'network' | 'other';
export type PlanActionStatusLike = 'suggested' | 'in_progress' | 'done' | 'dropped';

/** One action to persist inside a plan (input shape). */
export interface PersistPlanActionLike {
  actionKey: string;
  kind: PlanActionKindLike;
  title: string;
  rationale: string;
  orderIndex: number;
  evidenceRefs: string[];
}

/** One horizon plan to persist (input shape). */
export interface PersistPlanLike {
  horizon: PlanHorizonLike;
  summary: string;
  goalRefs: string[];
  diffSummary?: string | null;
  rationale?: string | null;
  modelVersion: string;
  actions: PersistPlanActionLike[];
}

/** A persisted plan action (output shape). */
export interface PlanActionRecordLike {
  id: string;
  actionKey: string;
  kind: PlanActionKindLike;
  title: string;
  rationale: string;
  orderIndex: number;
  status: PlanActionStatusLike;
  progress: number;
  evidenceRefs: string[];
}

/** A persisted plan with its actions (output shape). */
export interface StrategyPlanRecordLike {
  id: string;
  horizon: PlanHorizonLike;
  status: PlanStatusLike;
  summary: string;
  goalRefs: string[];
  diffSummary: string | null;
  rationale: string | null;
  modelVersion: string;
  supersededById: string | null;
  createdAt: string;
  updatedAt: string;
  actions: PlanActionRecordLike[];
}

/** Narrow port the apps/api handler depends on (matches StrategyPlanStorePort there). */
export interface StrategyPlanStorePortShape {
  /**
   * Persist the given horizon plans as ACTIVE for the user, superseding any prior
   * active plan for the SAME horizon (with a stored diff/rationale on the new row).
   * Handles both first-generation (no prior) and regeneration.
   */
  writeActivePlans(userId: string, plans: PersistPlanLike[]): Promise<StrategyPlanRecordLike[]>;
  /** All ACTIVE plans for the user, ordered short → long horizon, actions in order. */
  getActivePlans(userId: string): Promise<StrategyPlanRecordLike[]>;
  /** The ACTIVE plan for one horizon (null when none / not owned). */
  getActivePlanByHorizon(
    userId: string,
    horizon: PlanHorizonLike,
  ): Promise<StrategyPlanRecordLike | null>;
  /** Patch a plan action's adherence (status/progress). Null when not owned. */
  updateAction(
    userId: string,
    actionId: string,
    patch: { status?: PlanActionStatusLike; progress?: number },
  ): Promise<PlanActionRecordLike | null>;
}

// ---- enum <-> domain translation (Prisma members can't start with a digit) ----

const HORIZON_TO_DB: Record<PlanHorizonLike, StrategyPlanHorizon> = {
  '30d': 'd30',
  '90d': 'd90',
  '1y': 'y1',
  '3y': 'y3',
  '5y': 'y5',
};
const HORIZON_FROM_DB: Record<StrategyPlanHorizon, PlanHorizonLike> = {
  d30: '30d',
  d90: '90d',
  y1: '1y',
  y3: '3y',
  y5: '5y',
};
const HORIZON_ORDER: PlanHorizonLike[] = ['30d', '90d', '1y', '3y', '5y'];

// ---- row shapes (subset) returned by Prisma queries below ----

interface ActionRow {
  id: string;
  actionKey: string;
  kind: PlanActionKind;
  title: string;
  rationale: string;
  orderIndex: number;
  status: PlanActionStatus;
  progress: number;
  evidenceRefs: Prisma.JsonValue;
}

interface PlanRow {
  id: string;
  horizon: StrategyPlanHorizon;
  status: StrategyPlanStatus;
  summary: string;
  goalRefs: Prisma.JsonValue;
  diffSummary: string | null;
  rationale: string | null;
  modelVersion: string;
  supersededById: string | null;
  createdAt: Date;
  updatedAt: Date;
  actions: ActionRow[];
}

export class PrismaStrategyPlanStore implements StrategyPlanStorePortShape {
  constructor(private readonly prisma: PrismaClient) {}

  async writeActivePlans(
    userId: string,
    plans: PersistPlanLike[],
  ): Promise<StrategyPlanRecordLike[]> {
    const writtenIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const plan of plans) {
        const dbHorizon = HORIZON_TO_DB[plan.horizon];
        // Supersede any prior active plan for this horizon FIRST so the partial
        // unique (user, horizon) WHERE status='active' index never trips.
        const prior = await tx.strategyPlan.findFirst({
          where: { userId, horizon: dbHorizon, status: 'active' },
          select: { id: true },
        });
        if (prior) {
          await tx.strategyPlan.update({
            where: { id: prior.id },
            data: { status: 'superseded' },
          });
        }
        const newId = randomUUID();
        await tx.strategyPlan.create({
          data: {
            id: newId,
            user: { connect: { id: userId } },
            horizon: dbHorizon,
            status: 'active',
            summary: plan.summary,
            goalRefs: plan.goalRefs,
            diffSummary: plan.diffSummary ?? null,
            rationale: plan.rationale ?? null,
            modelVersion: plan.modelVersion,
            actions: {
              create: plan.actions.map((a) => ({
                id: randomUUID(),
                actionKey: a.actionKey,
                kind: a.kind,
                title: a.title,
                rationale: a.rationale,
                orderIndex: a.orderIndex,
                evidenceRefs: a.evidenceRefs,
              })),
            },
          },
        });
        // Point the superseded row forward to its replacement (supersession chain).
        if (prior) {
          await tx.strategyPlan.update({
            where: { id: prior.id },
            data: { supersededById: newId },
          });
        }
        writtenIds.push(newId);
      }
    });

    const rows = await this.prisma.strategyPlan.findMany({
      where: { id: { in: writtenIds } },
      include: { actions: { orderBy: { orderIndex: 'asc' } } },
    });
    return this.sortByHorizon(rows.map((r) => this.toRecord(r)));
  }

  async getActivePlans(userId: string): Promise<StrategyPlanRecordLike[]> {
    const rows = await this.prisma.strategyPlan.findMany({
      where: { userId, status: 'active' },
      include: { actions: { orderBy: { orderIndex: 'asc' } } },
    });
    return this.sortByHorizon(rows.map((r) => this.toRecord(r)));
  }

  async getActivePlanByHorizon(
    userId: string,
    horizon: PlanHorizonLike,
  ): Promise<StrategyPlanRecordLike | null> {
    const row = await this.prisma.strategyPlan.findFirst({
      where: { userId, horizon: HORIZON_TO_DB[horizon], status: 'active' },
      include: { actions: { orderBy: { orderIndex: 'asc' } } },
    });
    return row ? this.toRecord(row) : null;
  }

  async updateAction(
    userId: string,
    actionId: string,
    patch: { status?: PlanActionStatusLike; progress?: number },
  ): Promise<PlanActionRecordLike | null> {
    // Scope check via the parent plan's user — never touch another user's action.
    const owned = await this.prisma.planAction.findFirst({
      where: { id: actionId, plan: { userId } },
      select: { id: true },
    });
    if (!owned) return null;

    const data: Prisma.PlanActionUpdateInput = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.progress !== undefined) data.progress = patch.progress;

    const row = await this.prisma.planAction.update({ where: { id: actionId }, data });
    return this.toActionRecord(row);
  }

  // ---------------- mappers ----------------

  private sortByHorizon(records: StrategyPlanRecordLike[]): StrategyPlanRecordLike[] {
    return [...records].sort(
      (a, b) => HORIZON_ORDER.indexOf(a.horizon) - HORIZON_ORDER.indexOf(b.horizon),
    );
  }

  private toRecord(row: PlanRow): StrategyPlanRecordLike {
    return {
      id: row.id,
      horizon: HORIZON_FROM_DB[row.horizon],
      status: row.status,
      summary: row.summary,
      goalRefs: toStringArray(row.goalRefs),
      diffSummary: row.diffSummary,
      rationale: row.rationale,
      modelVersion: row.modelVersion,
      supersededById: row.supersededById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      actions: row.actions.map((a) => this.toActionRecord(a)),
    };
  }

  private toActionRecord(row: ActionRow): PlanActionRecordLike {
    return {
      id: row.id,
      actionKey: row.actionKey,
      kind: row.kind,
      title: row.title,
      rationale: row.rationale,
      orderIndex: row.orderIndex,
      status: row.status,
      progress: row.progress,
      evidenceRefs: toStringArray(row.evidenceRefs),
    };
  }
}

/** Coerce a Prisma JSON value into a string[] (defensive at the boundary). */
function toStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}