import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * Prisma-backed store for discovery-time MatchScores (database-schema.md
 * §opportunity). A MatchScore is the honest, grounded output of the M03 scorer
 * for a (profile, opportunity) pair — `overall` + `subscores` + a plain-language
 * `explanation` (never a bare number) + `evidenceRefs` + a `modelVersion` stamp.
 *
 * UNIQUE (profile_id, opportunity_id, model_version): 1:many OVER model versions;
 * `upsert` writes on that key so re-scoring the same pair with the same model
 * version is idempotent, while a NEW model version yields a NEW reproducible row.
 * `findLatest` reads the row for the given model version — the display view.
 *
 * PER-USER by construction: `profileId` binds the score to one user's profile, so
 * users A and B get DIFFERENT rows for the SAME opportunity.
 *
 * The `MatchScoreLike`/`MatchSubscoreLike` shapes mirror @careeros/cie-resume's
 * MatchScore STRUCTURALLY (by value) so @careeros/db stays free of a dependency on
 * the resume package — the apps/api handler passes the scorer's output straight in.
 */

export interface MatchSubscoreLike {
  key: string;
  value: number;
}

export interface MatchScoreLike {
  overall: number;
  subscores: MatchSubscoreLike[];
  explanation: string;
  evidenceRefs: string[];
  modelVersion?: string;
}

/** Narrow port the apps/api handler depends on (matches MatchScoreStore there). */
export interface MatchScoreStorePort {
  findLatest(profileId: string, opportunityId: string, modelVersion: string): Promise<MatchScoreLike | null>;
  upsert(profileId: string, opportunityId: string, score: MatchScoreLike): Promise<MatchScoreLike>;
}

export class PrismaMatchScoreStore implements MatchScoreStorePort {
  constructor(private readonly prisma: PrismaClient) {}

  async findLatest(profileId: string, opportunityId: string, modelVersion: string): Promise<MatchScoreLike | null> {
    const row = await this.prisma.matchScore.findUnique({
      where: {
        profileId_opportunityId_modelVersion: { profileId, opportunityId, modelVersion },
      },
    });
    return row ? this.toDomain(row) : null;
  }

  async upsert(profileId: string, opportunityId: string, score: MatchScoreLike): Promise<MatchScoreLike> {
    const modelVersion = score.modelVersion ?? 'unknown';
    const row = await this.prisma.matchScore.upsert({
      where: {
        profileId_opportunityId_modelVersion: { profileId, opportunityId, modelVersion },
      },
      create: {
        id: randomUUID(),
        profile: { connect: { id: profileId } },
        opportunity: { connect: { id: opportunityId } },
        overall: Math.round(score.overall),
        subscores: score.subscores as unknown as Prisma.InputJsonValue,
        explanation: score.explanation,
        evidenceRefs: score.evidenceRefs,
        modelVersion,
      },
      update: {
        overall: Math.round(score.overall),
        subscores: score.subscores as unknown as Prisma.InputJsonValue,
        explanation: score.explanation,
        evidenceRefs: score.evidenceRefs,
      },
    });

    return this.toDomain(row);
  }

  private toDomain(row: {
    overall: number;
    subscores: Prisma.JsonValue;
    explanation: string;
    evidenceRefs: Prisma.JsonValue;
    modelVersion: string;
  }): MatchScoreLike {
    return {
      overall: row.overall,
      subscores: row.subscores as unknown as MatchSubscoreLike[],
      explanation: row.explanation,
      evidenceRefs: row.evidenceRefs as unknown as string[],
      modelVersion: row.modelVersion,
    };
  }
}
