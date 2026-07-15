import type { PrismaClient } from '@prisma/client';

/**
 * Resolves a verified userId to their single Profile row id — the seam the M04
 * match handler uses to bind a discovery-time MatchScore to the CALLER's profile
 * (per-user by construction). Returns null when the user has no profile yet (they
 * must import a profile before a match can be scored against it).
 */
export interface ProfileResolverPort {
  resolveProfileId(userId: string): Promise<string | null>;
}

export class PrismaProfileResolver implements ProfileResolverPort {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveProfileId(userId: string): Promise<string | null> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { id: true },
    });
    return profile?.id ?? null;
  }
}
