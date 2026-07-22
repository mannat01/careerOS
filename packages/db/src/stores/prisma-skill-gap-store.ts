import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * Prisma-backed store for SkillGaps + LearningItems (database-schema.md §cie:
 * Profile 1:N SkillGap 1:N LearningItem) — M09 Step 3.
 *
 * `replaceForProfile` persists ONE computed gap set atomically: it deletes the
 * profile's prior gaps (cascade removes their learning items EXCEPT those the
 * user has started — in-progress/done items keep their gap row alive so
 * progress is never silently lost) and inserts the new set with its linked
 * suggested learning items. Re-running the analyzer is therefore idempotent.
 *
 * PER-USER by construction: every read/write is scoped by `profileId`; a
 * learning item PATCH resolves through its gap's profile, so cross-user ids
 * simply return null (handler → 404).
 *
 * Shapes are STRUCTURAL mirrors of @careeros/cie-skills' computed types so
 * @careeros/db stays free of a dependency on the skills package.
 */

export interface SkillGapRowLike {
  id: string;
  skill: string;
  gap: string;
  severity: string;
  source: 'per_opp' | 'aggregate';
  opportunityId: string | null;
  evidenceRefs: string[];
  modelVersion: string;
  computedAt: string;
}

export interface LearningItemRowLike {
  id: string;
  skillGapId: string;
  resource: Record<string, unknown>;
  status: 'suggested' | 'in_progress' | 'done';
  progress: number;
}

export interface SkillGapWriteLike {
  skill: string;
  gap: string;
  severity: string;
  source: 'per_opp' | 'aggregate';
  opportunityId?: string;
  evidenceRefs: string[];
  modelVersion: string;
  learningItems: Array<{ resource: Record<string, unknown> }>;
}

/** Narrow port the apps/api skills handlers depend on. */
export interface SkillGapStorePortShape {
  replaceForProfile(profileId: string, gaps: SkillGapWriteLike[]): Promise<SkillGapRowLike[]>;
  listGaps(profileId: string): Promise<SkillGapRowLike[]>;
  listLearningItems(profileId: string): Promise<LearningItemRowLike[]>;
  updateLearningItem(
    profileId: string,
    id: string,
    patch: { status?: 'suggested' | 'in_progress' | 'done'; progress?: number },
  ): Promise<LearningItemRowLike | null>;
}

export class PrismaSkillGapStore implements SkillGapStorePortShape {
  constructor(private readonly prisma: PrismaClient) {}

  async replaceForProfile(profileId: string, gaps: SkillGapWriteLike[]): Promise<SkillGapRowLike[]> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      // Keep gaps whose learning items the user has started; replace the rest.
      await tx.skillGap.deleteMany({
        where: {
          profileId,
          learningItems: { none: { status: { in: ['in_progress', 'done'] } } },
        },
      });
      const kept = await tx.skillGap.findMany({ where: { profileId }, select: { skill: true, source: true, opportunityId: true } });
      const keptKeys = new Set(kept.map((k) => `${k.source}:${k.skill}:${k.opportunityId ?? ''}`));

      for (const gap of gaps) {
        const dedupe = `${gap.source}:${gap.skill}:${gap.opportunityId ?? ''}`;
        if (keptKeys.has(dedupe)) continue;
        await tx.skillGap.create({
          data: {
            id: randomUUID(),
            profileId,
            opportunityId: gap.opportunityId ?? null,
            skill: gap.skill,
            gap: gap.gap,
            severity: gap.severity,
            source: gap.source,
            evidenceRefs: gap.evidenceRefs,
            modelVersion: gap.modelVersion,
            computedAt: now,
            learningItems: {
              create: gap.learningItems.map((item) => ({
                id: randomUUID(),
                resource: item.resource as Prisma.InputJsonValue,
              })),
            },
          },
        });
      }

      const rows = await tx.skillGap.findMany({
        where: { profileId },
        orderBy: [{ source: 'asc' }, { skill: 'asc' }],
      });
      return rows.map((row) => this.toGap(row));
    });
  }

  async listGaps(profileId: string): Promise<SkillGapRowLike[]> {
    const rows = await this.prisma.skillGap.findMany({
      where: { profileId },
      orderBy: [{ source: 'asc' }, { skill: 'asc' }],
    });
    return rows.map((row) => this.toGap(row));
  }

  async listLearningItems(profileId: string): Promise<LearningItemRowLike[]> {
    const rows = await this.prisma.learningItem.findMany({
      where: { skillGap: { profileId } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toItem(row));
  }

  async updateLearningItem(
    profileId: string,
    id: string,
    patch: { status?: 'suggested' | 'in_progress' | 'done'; progress?: number },
  ): Promise<LearningItemRowLike | null> {
    // Scope the lookup by the OWNING profile — a cross-user id is unreachable.
    const existing = await this.prisma.learningItem.findFirst({
      where: { id, skillGap: { profileId } },
      select: { id: true },
    });
    if (!existing) return null;
    const row = await this.prisma.learningItem.update({
      where: { id },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
      },
    });
    return this.toItem(row);
  }

  private toGap(row: {
    id: string;
    skill: string;
    gap: string;
    severity: string;
    source: string;
    opportunityId: string | null;
    evidenceRefs: Prisma.JsonValue;
    modelVersion: string;
    computedAt: Date;
  }): SkillGapRowLike {
    return {
      id: row.id,
      skill: row.skill,
      gap: row.gap,
      severity: row.severity,
      source: row.source as SkillGapRowLike['source'],
      opportunityId: row.opportunityId,
      evidenceRefs: Array.isArray(row.evidenceRefs) ? (row.evidenceRefs as string[]) : [],
      modelVersion: row.modelVersion,
      computedAt: row.computedAt.toISOString(),
    };
  }

  private toItem(row: {
    id: string;
    skillGapId: string;
    resource: Prisma.JsonValue;
    status: string;
    progress: number;
  }): LearningItemRowLike {
    return {
      id: row.id,
      skillGapId: row.skillGapId,
      resource: (row.resource ?? {}) as Record<string, unknown>,
      status: row.status as LearningItemRowLike['status'],
      progress: row.progress,
    };
  }
}