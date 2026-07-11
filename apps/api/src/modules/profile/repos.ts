import type { ParsedEntity, ImportedEntity } from '@careeros/contracts';

/**
 * Profile persistence boundary — apps/api owns the interface; the Prisma-backed
 * implementation lives in @careeros/db behind it (same inversion as identity).
 * The handler stays pure and DB-free-testable against InMemoryProfileRepo.
 *
 * Every write is PER-USER scoped: `importEntities` resolves (or creates) the
 * caller's single Profile and attaches all entities to it. A repo can never be
 * asked to write to another user's profile — the only key is the verified userId.
 */
export interface ProfileImportResult {
  profileId: string;
  entities: ImportedEntity[];
}

export interface ProfileRepo {
  /**
   * Upsert the user's Profile, then persist every extracted entity under it,
   * preserving provenance. Returns the profile id + the persisted entities
   * (with their generated ids) for the response echo.
   */
  importEntities(userId: string, entities: ParsedEntity[]): Promise<ProfileImportResult>;
}

// STUB(M01/M02): in-memory fake used by DB-free unit tests. Mirrors the Prisma
// store's scoping contract: one profile per user, entities attached to it.
export class InMemoryProfileRepo implements ProfileRepo {
  private readonly profileByUser = new Map<string, string>();
  /** profileId → persisted entities (with their assigned ids). */
  private readonly entitiesByProfile = new Map<string, ImportedEntity[]>();
  private seq = 0;

  constructor(private readonly idFactory: () => string = () => `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`) {}

  importEntities(userId: string, entities: ParsedEntity[]): Promise<ProfileImportResult> {
    let profileId = this.profileByUser.get(userId);
    if (profileId === undefined) {
      profileId = this.idFactory();
      this.profileByUser.set(userId, profileId);
      this.entitiesByProfile.set(profileId, []);
    }
    const persisted = entities.map((e) => ({
      id: this.idFactory(),
      kind: e.kind,
      name: e.name,
      ...(e.detail !== undefined ? { detail: e.detail } : {}),
      provenance: e.provenance,
    }));
    this.entitiesByProfile.get(profileId)?.push(...persisted);
    return Promise.resolve({ profileId, entities: persisted });
  }

  /** Test helper: everything persisted for a user (asserts scoping). */
  dump(userId: string): ImportedEntity[] {
    const pid = this.profileByUser.get(userId);
    return pid ? (this.entitiesByProfile.get(pid) ?? []) : [];
  }
}
