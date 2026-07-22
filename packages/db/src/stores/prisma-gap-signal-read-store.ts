import type { PrismaClient } from '@prisma/client';

/**
 * Read-only projections the M09 GapAnalyzer needs (per-user):
 *   - match signals: the profile's persisted MatchScores joined with each
 *     opportunity's REAL parsed requirements (`requirements_parsed`) — the
 *     demanded universe for per-opportunity gaps;
 *   - stated target roles from profiles.target_roles — the aggregate anchor.
 *
 * Shapes STRUCTURALLY mirror @careeros/cie-skills' port inputs so @careeros/db
 * stays free of a dependency on the skills package.
 */

export interface GapMatchSignalLike {
  opportunityId: string;
  opportunityLabel: string;
  subscores: Array<{ key: string; value: number }>;
  requiredSkills: string[];
}

/** Narrow port the apps/api skills adapters depend on. */
export interface GapSignalReadPortShape {
  readMatchSignals(profileId: string): Promise<GapMatchSignalLike[]>;
  readTargetRoles(profileId: string): Promise<string[]>;
}

export class PrismaGapSignalReadStore implements GapSignalReadPortShape {
  constructor(private readonly prisma: PrismaClient) {}

  async readMatchSignals(profileId: string): Promise<GapMatchSignalLike[]> {
    const rows = await this.prisma.matchScore.findMany({
      where: { profileId },
      orderBy: { updatedAt: 'desc' },
      include: {
        opportunity: { select: { company: true, role: true, requirementsParsed: true } },
      },
    });
    // One signal per opportunity — latest score wins (rows are newest-first).
    const seen = new Set<string>();
    const signals: GapMatchSignalLike[] = [];
    for (const row of rows) {
      if (seen.has(row.opportunityId)) continue;
      seen.add(row.opportunityId);
      signals.push({
        opportunityId: row.opportunityId,
        opportunityLabel: `${row.opportunity.company} — ${row.opportunity.role}`,
        subscores: toSubscores(row.subscores),
        requiredSkills: toRequiredSkills(row.opportunity.requirementsParsed),
      });
    }
    return signals;
  }

  async readTargetRoles(profileId: string): Promise<string[]> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: { targetRoles: true },
    });
    const raw = profile?.targetRoles;
    if (!Array.isArray(raw)) return [];
    return raw.filter((r): r is string => typeof r === 'string');
  }
}

function toSubscores(raw: unknown): Array<{ key: string; value: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ key: string; value: number }> = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const rec = entry as Record<string, unknown>;
    if (typeof rec['key'] === 'string' && typeof rec['value'] === 'number') {
      out.push({ key: rec['key'], value: rec['value'] });
    }
  }
  return out;
}

/** requirements_parsed may be a string[] or `{ skills: string[] }`. */
function toRequiredSkills(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string');
  if (typeof raw === 'object' && raw !== null) {
    const skills = (raw as Record<string, unknown>)['skills'];
    if (Array.isArray(skills)) return skills.filter((s): s is string => typeof s === 'string');
  }
  return [];
}