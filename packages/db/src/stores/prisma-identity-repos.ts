import {
  onboardingStateFromCompletedAt,
  type AutonomyTier,
  type MeResponse,
  type OnboardingCompletionResponse,
  type User,
  type UserSettings,
} from '@careeros/contracts';
import { PrismaClient, Prisma } from '@prisma/client';
import type {
  IdentityBootstrapRepo,
  OnboardingCompletionRepo,
  OnboardingCompletionResult,
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

/**
 * Atomic first-run completion. The verified caller id is the only ownership
 * input; eligibility, timestamp mutation, and the single event all share one
 * transaction. A concurrent/idempotent loser observes `updateMany.count = 0`
 * and returns the winning state without appending a duplicate event.
 */
export class PrismaOnboardingCompletionRepo implements OnboardingCompletionRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async complete(userId: string, completedAt: string): Promise<OnboardingCompletionResult> {
    return this.prisma.$transaction(async (tx) => {
      let changed = false;
      const current = await tx.user.findUnique({
        where: { id: userId },
        include: { settings: true },
      });
      if (!current || !current.settings) throw new Error('Identity unavailable.');

      if (current.onboardingCompletedAt === null) {
        const profile = await tx.profile.findUnique({
          where: { userId },
          select: {
            id: true,
            _count: { select: { experiences: true, projects: true, education: true, skillClaims: true } },
          },
        });
        const factCount = profile === null
          ? 0
          : profile._count.experiences + profile._count.projects +
            profile._count.education + profile._count.skillClaims;
        if (factCount === 0) return { kind: 'profile_required' };

        const transition = await tx.user.updateMany({
          where: { id: userId, onboardingCompletedAt: null },
          data: { onboardingCompletedAt: new Date(completedAt) },
        });
        changed = transition.count === 1;
        if (transition.count === 1) {
          await tx.memoryEvent.create({
            data: {
              userId,
              type: 'user_decision',
              payload: {
                kind: 'onboarding_completed',
                profileId: profile!.id,
              },
              rationale: 'Onboarding completed.',
            },
          });
        }
      }

      const completed = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { settings: true },
      });
      if (!completed.settings || completed.onboardingCompletedAt === null) {
        throw new Error('Completion state unavailable.');
      }
      return {
        kind: 'completed',
        changed,
        me: toCompletedMe(completed),
      };
    });
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

function toCompletedMe(row: {
  id: string;
  email: string;
  authProviderId: string;
  subscriptionTier: 'free' | 'pro';
  status: 'active' | 'suspended' | 'deleted';
  onboardingCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  settings: Parameters<typeof toSettings>[0] | null;
}): OnboardingCompletionResponse {
  if (!row.settings || row.onboardingCompletedAt === null) {
    throw new Error('Expected completed identity and settings.');
  }
  const completedAt = row.onboardingCompletedAt.toISOString();
  return {
    user: {
      id: row.id,
      email: row.email,
      authProviderId: row.authProviderId,
      subscriptionTier: row.subscriptionTier,
      status: row.status,
      onboardingCompletedAt: completedAt,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    settings: toSettings(row.settings),
    onboarding: { status: 'complete', completedAt },
  };
}

export class PrismaUserLifecycleRepo implements UserLifecycleRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async hardDelete(userId: string): Promise<void> {
    // Cascade deletes all user-owned rows (settings, profile, audit, tokens, etc.)
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
