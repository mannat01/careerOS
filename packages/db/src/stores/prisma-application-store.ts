import { randomUUID } from 'node:crypto';
import type { PrismaClient, ApplicationStatus, AuditActor, Prisma } from '@prisma/client';

/**
 * Prisma-backed store for the M04 application pipeline (database-schema.md
 * §application). The apps/api handler depends on this STRUCTURALLY (its narrow
 * ApplicationStorePort) so @careeros/db carries no dependency on apps/api.
 *
 * PER-USER by construction: every read/write is scoped by `userId`, so a caller
 * can neither read nor mutate another user's applications — a `getById(userId,id)`
 * for someone else's row returns null (surfaced as 404), never the row.
 *
 * Status changes are applied in ONE transaction that also appends an APPEND-ONLY
 * timeline row and, on the `applied` transition, stamps `appliedAt`. The store
 * NEVER decides whether a transition is legal — that discipline (including the
 * applied-only-by-user invariant) lives in the pure status-machine in apps/api;
 * the store just persists what the handler already authorized.
 */

// ---- structural shapes mirroring the apps/api contracts (by value, no import) ----

export type ApplicationStatusLike =
  | 'saved'
  | 'drafting'
  | 'ready'
  | 'applied'
  | 'screening'
  | 'interviewing'
  | 'offer'
  | 'closed';

export type ApplicationActorLike = 'user' | 'twin' | 'system';

export interface ApplicationTimelineEntryLike {
  id: string;
  fromStatus: ApplicationStatusLike | null;
  toStatus: ApplicationStatusLike;
  actor: ApplicationActorLike;
  note: string | null;
  at: string;
}

export interface ApplicationLike {
  id: string;
  opportunityId: string;
  resumeVariantId: string | null;
  status: ApplicationStatusLike;
  notes: string | null;
  followUpAt: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationDetailLike extends ApplicationLike {
  timeline: ApplicationTimelineEntryLike[];
}

export interface ApplicationFollowUpLike {
  id: string;
  applicationId: string;
  dueAt: string;
  note: string | null;
  done: boolean;
  createdAt: string;
}

export interface ApplicationUpdateCommandLike {
  notes?: string;
  followUpAt?: string | null;
  statusChange?: {
    to: ApplicationStatusLike;
    actor: ApplicationActorLike;
    setAppliedAt: boolean;
    note?: string;
  };
}

/** Narrow port the apps/api handler depends on (matches ApplicationStorePort there). */
export interface ApplicationStorePortShape {
  create(
    userId: string,
    input: { opportunityId: string; resumeVariantId?: string; notes?: string },
  ): Promise<ApplicationDetailLike>;
  getById(userId: string, id: string): Promise<ApplicationDetailLike | null>;
  list(userId: string): Promise<ApplicationLike[]>;
  update(userId: string, id: string, command: ApplicationUpdateCommandLike): Promise<ApplicationDetailLike | null>;
  addFollowUp(
    userId: string,
    id: string,
    input: { dueAt: string; note?: string },
  ): Promise<ApplicationFollowUpLike | null>;
}

// Row shapes (subset) returned by Prisma queries below.
interface AppRow {
  id: string;
  opportunityId: string;
  resumeVariantId: string | null;
  status: ApplicationStatus;
  notes: string | null;
  followUpAt: Date | null;
  appliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface TimelineRow {
  id: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  actor: AuditActor;
  note: string | null;
  at: Date;
}

export class PrismaApplicationStore implements ApplicationStorePortShape {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    userId: string,
    input: { opportunityId: string; resumeVariantId?: string; notes?: string },
  ): Promise<ApplicationDetailLike> {
    const id = randomUUID();
    await this.prisma.application.create({
      data: {
        id,
        user: { connect: { id: userId } },
        opportunityId: input.opportunityId,
        resumeVariantId: input.resumeVariantId ?? null,
        status: 'saved',
        notes: input.notes ?? null,
        // Seed the append-only timeline with the creation event (from=null → saved).
        timeline: {
          create: {
            id: randomUUID(),
            fromStatus: null,
            toStatus: 'saved',
            actor: 'user',
            note: null,
          },
        },
      },
    });
    // Re-read the full detail (scoped) so create + get return the same shape.
    const detail = await this.getById(userId, id);
    // Non-null by construction — we just created it under this user.
    return detail!;
  }

  async getById(userId: string, id: string): Promise<ApplicationDetailLike | null> {
    const row = await this.prisma.application.findFirst({
      where: { id, userId },
      include: { timeline: { orderBy: { at: 'asc' } } },
    });
    if (!row) return null;
    return this.toDetail(row, row.timeline);
  }

  async list(userId: string): Promise<ApplicationLike[]> {
    const rows = await this.prisma.application.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map((r) => this.toApplication(r));
  }

  async update(
    userId: string,
    id: string,
    command: ApplicationUpdateCommandLike,
  ): Promise<ApplicationDetailLike | null> {
    // Scope check first — never touch a row the caller doesn't own.
    const owned = await this.prisma.application.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) return null;

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.ApplicationUpdateInput = {};
      if (command.notes !== undefined) data.notes = command.notes;
      if (command.followUpAt !== undefined) data.followUpAt = command.followUpAt ? new Date(command.followUpAt) : null;

      if (command.statusChange) {
        const sc = command.statusChange;
        data.status = sc.to as ApplicationStatus;
        if (sc.setAppliedAt) data.appliedAt = new Date();
        // Read the current status inside the tx to record an accurate `fromStatus`,
        // then append ONE immutable timeline row for this transition.
        const current = await tx.application.findUnique({ where: { id }, select: { status: true } });
        data.timeline = {
          create: {
            id: randomUUID(),
            fromStatus: current?.status ?? null,
            toStatus: sc.to as ApplicationStatus,
            actor: sc.actor as AuditActor,
            note: sc.note ?? null,
          },
        };
      }

      await tx.application.update({ where: { id }, data });
    });

    return this.getById(userId, id);
  }

  async addFollowUp(
    userId: string,
    id: string,
    input: { dueAt: string; note?: string },
  ): Promise<ApplicationFollowUpLike | null> {
    const owned = await this.prisma.application.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) return null;

    const row = await this.prisma.applicationFollowUp.create({
      data: {
        id: randomUUID(),
        applicationId: id,
        dueAt: new Date(input.dueAt),
        note: input.note ?? null,
      },
    });
    return {
      id: row.id,
      applicationId: row.applicationId,
      dueAt: row.dueAt.toISOString(),
      note: row.note,
      done: row.done,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---------------- mappers ----------------

  private toApplication(row: AppRow): ApplicationLike {
    return {
      id: row.id,
      opportunityId: row.opportunityId,
      resumeVariantId: row.resumeVariantId,
      status: row.status as ApplicationStatusLike,
      notes: row.notes,
      followUpAt: row.followUpAt ? row.followUpAt.toISOString() : null,
      appliedAt: row.appliedAt ? row.appliedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(row: AppRow, timeline: TimelineRow[]): ApplicationDetailLike {
    return {
      ...this.toApplication(row),
      timeline: timeline.map((t) => ({
        id: t.id,
        fromStatus: t.fromStatus ? (t.fromStatus as ApplicationStatusLike) : null,
        toStatus: t.toStatus as ApplicationStatusLike,
        actor: t.actor as ApplicationActorLike,
        note: t.note,
        at: t.at.toISOString(),
      })),
    };
  }
}

/**
 * Tiny existence checker so the create handler can 404 an unknown opportunity id
 * without pulling the whole read store. Opportunities are GLOBAL (not per-user),
 * so this is a plain id lookup.
 */
export class PrismaOpportunityExists {
  constructor(private readonly prisma: PrismaClient) {}

  async exists(opportunityId: string): Promise<boolean> {
    const row = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
      select: { id: true },
    });
    return row !== null;
  }
}
