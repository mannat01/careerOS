import { PrismaClient, Prisma } from '@prisma/client';
import type {
  DerivedInsight,
  DerivedInsightInput,
  EpisodicStore,
  MemoryEvent,
  MemoryEventInput,
  ProfileFact,
  ProfileReader,
  SemanticStore,
} from '@careeros/memory';

/**
 * Prisma-backed adapters for the @careeros/memory tier PORTS. These are the ONLY
 * code paths that touch the memory tables (memory_events, derived_insights) plus
 * the read-only profile projection. They implement interfaces OWNED by
 * @careeros/memory, so the dependency arrow points db → memory (never the reverse)
 * and the "only packages/memory touches memory tables" boundary holds: agents go
 * through MemoryService, which is wired to these at bootstrap.
 */

// ---------------- profile tier (read-only structured facts) ----------------

/**
 * Reads the extracted, authoritative entities via the identity/profile rows and
 * projects them into flat ProfileFacts for retrieval. Read-only: it never writes
 * profile data — that stays owned by the profile import path.
 */
export class PrismaProfileReader implements ProfileReader {
  constructor(private readonly prisma: PrismaClient) {}

  async readFacts(userId: string): Promise<ProfileFact[]> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      include: { experiences: true, projects: true, education: true, skillClaims: true },
    });
    if (!profile) return [];

    const facts: ProfileFact[] = [];
    for (const e of profile.experiences) {
      facts.push({
        kind: 'experience',
        text: [e.title, e.company].filter(Boolean).join(' at '),
        ref: `experience:${e.id}`,
      });
    }
    for (const p of profile.projects) {
      facts.push({
        kind: 'project',
        text: [p.name, p.description].filter(Boolean).join(' — '),
        ref: `project:${p.id}`,
      });
    }
    for (const ed of profile.education) {
      facts.push({
        kind: 'education',
        text: [ed.credential, ed.field, ed.institution].filter(Boolean).join(' '),
        ref: `education:${ed.id}`,
      });
    }
    for (const s of profile.skillClaims) {
      facts.push({ kind: 'skill', text: `${s.skill} (${s.level})`, ref: `skill:${s.id}` });
    }
    return facts;
  }
}

// ---------------- episodic tier (MemoryEvent, append-only) ----------------

/**
 * Append-only episodic store. It exposes ONLY append + read — there is no update
 * or delete method, so application code CANNOT mutate history. Rows are removed
 * solely by the account hard-delete cascade (ON DELETE CASCADE from users), the
 * same immutability contract as AuditLog (database-schema.md §4).
 */
export class PrismaEpisodicStore implements EpisodicStore {
  constructor(private readonly prisma: PrismaClient) {}

  async append(event: MemoryEventInput): Promise<MemoryEvent> {
    const row = await this.prisma.memoryEvent.create({
      data: {
        userId: event.userId,
        type: event.type,
        payload: event.payload as Prisma.InputJsonValue,
        ...(event.rationale !== undefined ? { rationale: event.rationale } : {}),
        ...(event.autonomyTier !== undefined ? { autonomyTier: event.autonomyTier } : {}),
      },
    });
    return toMemoryEvent(row);
  }

  async read(userId: string, limit?: number): Promise<MemoryEvent[]> {
    const rows = await this.prisma.memoryEvent.findMany({
      where: { userId },
      orderBy: { occurredAt: 'desc' },
      ...(limit !== undefined ? { take: limit } : {}),
    });
    return rows.map(toMemoryEvent);
  }
}

function toMemoryEvent(row: {
  id: string;
  userId: string;
  type: string;
  payload: Prisma.JsonValue;
  rationale: string | null;
  autonomyTier: string | null;
  occurredAt: Date;
}): MemoryEvent {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as MemoryEvent['type'],
    payload: (row.payload ?? {}) as Record<string, unknown>,
    ...(row.rationale !== null ? { rationale: row.rationale } : {}),
    ...(row.autonomyTier !== null ? { autonomyTier: row.autonomyTier } : {}),
    occurredAt: row.occurredAt.toISOString(),
  };
}

// ---------------- semantic tier (DerivedInsight, regenerable) ----------------

/**
 * Regenerable semantic store. `replaceAll` is a single-transaction drop+rebuild:
 * it deletes the profile's existing insights and writes the new set atomically.
 * This is how MemoryService.regenerate stays NON-AUTHORITATIVE — it only rewrites
 * the derived layer and never touches source facts.
 */
export class PrismaSemanticStore implements SemanticStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listByProfile(profileId: string): Promise<DerivedInsight[]> {
    const rows = await this.prisma.derivedInsight.findMany({
      where: { profileId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDerivedInsight);
  }

  async replaceAll(
    profileId: string,
    insights: DerivedInsightInput[],
  ): Promise<DerivedInsight[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.derivedInsight.deleteMany({ where: { profileId } });
      const created: DerivedInsight[] = [];
      for (const i of insights) {
        const row = await tx.derivedInsight.create({
          data: {
            profileId: i.profileId,
            statement: i.statement,
            sourceRefs: i.sourceRefs,
            freshnessAt: new Date(i.freshnessAt),
            ...(i.modelVersion !== undefined ? { modelVersion: i.modelVersion } : {}),
          },
        });
        created.push(toDerivedInsight(row));
      }
      return created;
    });
  }
}

function toDerivedInsight(row: {
  id: string;
  profileId: string;
  statement: string;
  sourceRefs: Prisma.JsonValue;
  freshnessAt: Date;
  modelVersion: string | null;
}): DerivedInsight {
  return {
    id: row.id,
    profileId: row.profileId,
    statement: row.statement,
    sourceRefs: (row.sourceRefs ?? []) as string[],
    freshnessAt: row.freshnessAt.toISOString(),
    ...(row.modelVersion !== null ? { modelVersion: row.modelVersion } : {}),
  };
}
