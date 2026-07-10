import type { AutonomyTier } from '@careeros/contracts';
import type { User, UserSettings } from '@careeros/contracts';
import { PrismaClient, Prisma } from '@prisma/client';
import type { UserRepo, UserSettingsRepo, UserLifecycleRepo } from '../../../../apps/api/src/modules/identity/repos.js';

/**
 * Prisma-backed identity repos.
 * These implement the interfaces defined in apps/api — the boundary is respected
 * because @careeros/db is a dependency of apps/api, not the other way around.
 * The actual wiring happens at the app bootstrap layer.
 */

export class PrismaUserRepo implements UserRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      authProviderId: row.authProviderId,
      subscriptionTier: row.subscriptionTier,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export class PrismaUserSettingsRepo implements UserSettingsRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUserId(userId: string): Promise<UserSettings | null> {
    const row = await this.prisma.userSettings.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      userId: row.userId,
      autonomyDefaults: row.autonomyDefaults as Record<string, AutonomyTier>,
      quietHours: row.quietHours as { start: string; end: string; timezone: string } | null,
      briefingSchedule: row.briefingSchedule as { cron: string; timezone: string } | null,
      sourcePrefs: row.sourcePrefs as Record<string, boolean>,
      dataUseOptIns: row.dataUseOptins as { training: boolean; crossUserIntel: boolean },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async save(settings: UserSettings): Promise<UserSettings> {
    const row = await this.prisma.userSettings.upsert({
      where: { userId: settings.userId },
      create: {
        userId: settings.userId,
        autonomyDefaults: settings.autonomyDefaults,
        quietHours: settings.quietHours as Prisma.InputJsonValue,
        briefingSchedule: settings.briefingSchedule as Prisma.InputJsonValue,
        sourcePrefs: settings.sourcePrefs,
        dataUseOptins: settings.dataUseOptIns,
      },
      update: {
        autonomyDefaults: settings.autonomyDefaults,
        quietHours: settings.quietHours as Prisma.InputJsonValue,
        briefingSchedule: settings.briefingSchedule as Prisma.InputJsonValue,
        sourcePrefs: settings.sourcePrefs,
        dataUseOptins: settings.dataUseOptIns,
      },
    });
    return {
      userId: row.userId,
      autonomyDefaults: row.autonomyDefaults as Record<string, AutonomyTier>,
      quietHours: row.quietHours as { start: string; end: string; timezone: string } | null,
      briefingSchedule: row.briefingSchedule as { cron: string; timezone: string } | null,
      sourcePrefs: row.sourcePrefs as Record<string, boolean>,
      dataUseOptIns: row.dataUseOptins as { training: boolean; crossUserIntel: boolean },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export class PrismaUserLifecycleRepo implements UserLifecycleRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async hardDelete(userId: string): Promise<void> {
    // Cascade deletes all user-owned rows (settings, profile, audit, tokens, etc.)
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
