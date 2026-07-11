import { PrismaClient, Prisma, type SkillLevel } from '@prisma/client';
import type { ImportedEntity, ParsedEntity } from '@careeros/contracts';
import type { ProfileRepo, ProfileImportResult } from '../../../../apps/api/src/modules/profile/repos.js';

/**
 * Prisma-backed ProfileRepo — implements the interface apps/api owns (boundary
 * respected: @careeros/db depends on apps/api types, not vice-versa).
 *
 * PER-USER SCOPING: every write goes through the caller's single Profile row,
 * resolved by `upsert({ where: { userId } })`. The userId is the ONLY key — a
 * request can never attach entities to another user's profile. All four entity
 * kinds are written in one transaction so an import is atomic.
 *
 * Provenance: rows are tagged `imported` (they came from a resume import). The
 * verbatim source quote rides along in the returned ImportedEntity for the API
 * response; the M01 schema's provenance enum records the origin class.
 */
export class PrismaProfileRepo implements ProfileRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async importEntities(userId: string, entities: ParsedEntity[]): Promise<ProfileImportResult> {
    return this.prisma.$transaction(async (tx) => {
      // Upsert the user's profile (one per user; created on first import).
      const profile = await tx.profile.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });

      const out: ImportedEntity[] = [];
      for (const e of entities) {
        const id = await persistEntity(tx, profile.id, e);
        out.push({
          id,
          kind: e.kind,
          name: e.name,
          ...(e.detail !== undefined ? { detail: e.detail } : {}),
          provenance: e.provenance,
        });
      }
      return { profileId: profile.id, entities: out };
    });
  }
}

type Tx = Prisma.TransactionClient;

/** Create one row for a parsed entity in its kind-specific table; return its id. */
async function persistEntity(tx: Tx, profileId: string, e: ParsedEntity): Promise<string> {
  switch (e.kind) {
    case 'experience': {
      const row = await tx.experience.create({
        data: {
          profileId,
          company: e.company ?? e.name,
          title: e.title ?? e.detail ?? '',
          start: parseDate(e.start),
          end: parseDate(e.end),
          skills: e.skills ?? [],
          provenance: 'imported',
        },
      });
      return row.id;
    }
    case 'project': {
      const row = await tx.project.create({
        data: {
          profileId,
          name: e.name,
          ...(e.detail !== undefined ? { description: e.detail } : {}),
          skills: e.skills ?? [],
          provenance: 'imported',
        },
      });
      return row.id;
    }
    case 'education': {
      const row = await tx.education.create({
        data: {
          profileId,
          institution: e.name,
          ...(e.credential !== undefined ? { credential: e.credential } : e.detail !== undefined ? { credential: e.detail } : {}),
          ...(e.field !== undefined ? { field: e.field } : {}),
          start: parseDate(e.start),
          end: parseDate(e.end),
          provenance: 'imported',
        },
      });
      return row.id;
    }
    case 'skill': {
      const row = await tx.skillClaim.create({
        data: {
          profileId,
          skill: e.name,
          level: evidenceToLevel(e.evidence),
          provenance: 'imported',
        },
      });
      return row.id;
    }
  }
}

/**
 * Map the two-value skill evidence to the schema's SkillLevel. This is a
 * REQUIRED persistence mapping (the column is non-null), not an invented fact:
 * a demonstrated skill is recorded advanced, a merely-claimed one intermediate.
 */
function evidenceToLevel(evidence: ParsedEntity['evidence']): SkillLevel {
  return evidence === 'demonstrated' ? 'advanced' : 'intermediate';
}

/**
 * Parse a loose resume date ('1990', '1990-05', '1990-05-01') to a Date, or null
 * for open-ended / non-date markers like 'present'. Deterministic; never throws.
 */
function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) - 1 : 0;
  const day = m[3] ? Number(m[3]) : 1;
  const d = new Date(Date.UTC(year, month, day));
  return Number.isNaN(d.getTime()) ? null : d;
}
