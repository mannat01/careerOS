import type { MeResponse, User, UserSettings } from '@careeros/contracts';

/**
 * Identity persistence boundary. apps/api owns these interfaces; the Prisma-backed
 * implementations live behind them so handlers stay pure and testable.
 */
export interface UserRepo {
  findById(id: string): Promise<User | null>;
}

export interface UserSettingsRepo {
  findByUserId(userId: string): Promise<UserSettings | null>;
  save(settings: UserSettings): Promise<UserSettings>;
}

export interface UserLifecycleRepo {
  /** Cascade hard delete of every user-owned row + artifacts + tokens. */
  hardDelete(userId: string): Promise<void>;
}

export interface IdentityBootstrapRepo {
  bootstrap(input: {
    userId: string;
    authProviderId: string;
    email: string;
    settings: UserSettings;
  }): Promise<MeResponse>;
}

// STUB(M01): in-memory fakes stand in for Prisma repositories over packages/db.
export class InMemoryUserRepo implements UserRepo {
  private readonly users = new Map<string, User>();
  seed(user: User): void {
    this.users.set(user.id, user);
  }
  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }
}

export class InMemoryIdentityBootstrapRepo implements IdentityBootstrapRepo {
  constructor(
    private readonly users: InMemoryUserRepo,
    private readonly settings: InMemoryUserSettingsRepo,
  ) {}

  async bootstrap(input: {
    userId: string;
    authProviderId: string;
    email: string;
    settings: UserSettings;
  }): Promise<MeResponse> {
    let user = await this.users.findById(input.userId);
    if (user === null) {
      const now = input.settings.createdAt;
      user = {
        id: input.userId,
        email: input.email,
        authProviderId: input.authProviderId,
        subscriptionTier: 'free',
        status: 'active',
        onboardingCompletedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.users.seed(user);
    }
    const settings = (await this.settings.findByUserId(user.id)) ??
      (await this.settings.save({ ...input.settings, userId: user.id }));
    return {
      user,
      settings,
      onboarding: user.onboardingCompletedAt === null
        ? { status: 'required', completedAt: null }
        : { status: 'complete', completedAt: user.onboardingCompletedAt },
    };
  }
}

export class InMemoryUserSettingsRepo implements UserSettingsRepo {
  private readonly byUser = new Map<string, UserSettings>();
  findByUserId(userId: string): Promise<UserSettings | null> {
    return Promise.resolve(this.byUser.get(userId) ?? null);
  }
  save(settings: UserSettings): Promise<UserSettings> {
    this.byUser.set(settings.userId, settings);
    return Promise.resolve(settings);
  }
}

export class InMemoryUserLifecycleRepo implements UserLifecycleRepo {
  readonly deleted: string[] = [];
  hardDelete(userId: string): Promise<void> {
    this.deleted.push(userId);
    return Promise.resolve();
  }
}
