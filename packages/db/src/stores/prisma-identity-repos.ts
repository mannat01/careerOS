import {
  onboardingStateFromCompletedAt,
  type AutonomyTier,
  type MeResponse,
  type User,
  type UserSettings,
} from '@careeros/contracts';
import { PrismaClient, Prisma } from '@prisma/client';
import type {
  IdentityBootstrapRepo,
  UserRepo,
  UserSettingsRepo,
  UserLifecycleRepo,
} from '../../../../apps/api/src/modules/identity/repos.js';

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
      onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export class PrismaIdentityBootstrapRepo implements IdentityBootstrapRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async bootstrap(input: {
    userId: string;
    authProviderId: string;
    email: string;
    settings: UserSettings;
  }): Promise<MeResponse> {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const legacy = await tx.user.findUnique({ where: { id: input.userId } });
          const user = legacy ?? await tx.user.upsert({
            where: { authProviderId: input.authProviderId },
            create: {
              id: input.userId,
              email: input.email,
              authProviderId: input.authProviderId,
              onboardingCompletedAt: null,
            },
            update: {},
          });

          const settings = await tx.userSettings.upsert({
            where: { userId: user.id },
            create: {
              userId: user.id,
              autonomyDefaults: input.settings.autonomyDefaults,
              quietHours: input.settings.quietHours as Prisma.InputJsonValue,
              briefingSchedule: input.settings.briefingSchedule as Prisma.InputJsonValue,
              sourcePrefs: input.settings.sourcePrefs,
              dataUseOptins: input.settings.dataUseOptIns,
            },
            update: {},
          });

          const userDto: User = {
            id: user.id,
            email: user.email,
            authProviderId: user.authProviderId,
            subscriptionTier: user.subscriptionTier,
            status: user.status,
            onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null,
            createdAt: user.createdAt.toISOString(),
            updatedAt: user.updatedAt.toISOString(),
          };
          return {
            user: userDto,
            settings: toSettings(settings),
            onboarding: onboardingStateFromCompletedAt(userDto.onboardingCompletedAt),
          };
        });
      } catch (error) {
        if (attempt === 4 || !isConcurrencyConflict(error)) throw error;
      }
    }
    throw new Error('unreachable bootstrap retry state');
  }
}

function isConcurrencyConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2002' || error.code === 'P2034');
}

export class PrismaUserSettingsRepo implements UserSettingsRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUserId(userId: string): Promise<UserSettings | null> {
    const row = await this.prisma.userSettings.findUnique({ where: { userId } });
    if (!row) return null;
    return toSettings(row);
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
    return toSettings(row);
  }
}

function toSettings(row: {
  userId: string;
  autonomyDefaults: Prisma.JsonValue;
  quietHours: Prisma.JsonValue | null;
  briefingSchedule: Prisma.JsonValue | null;
  sourcePrefs: Prisma.JsonValue;
  dataUseOptins: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): UserSettings {
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

export class PrismaUserLifecycleRepo implements UserLifecycleRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async hardDelete(userId: string): Promise<void> {
    // Cascade deletes all user-owned rows (settings, profile, audit, tokens, etc.)
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
