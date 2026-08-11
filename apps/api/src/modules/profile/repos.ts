import type {
  EditedProfileFact,
  ParsedEntity,
  ImportedEntity,
  ProfileFactEditRequest,
  ProfileResponse,
} from '@careeros/contracts';

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

export interface ProfileFactUpdateResult {
  profileId: string;
  beforeLabel: string;
  fact: EditedProfileFact;
}

type InMemoryProfileFact = Omit<ImportedEntity, 'provenance'> & {
  provenance: ImportedEntity['provenance'] | 'user';
};

export interface ProfileRepo {
  findByUserId(userId: string): Promise<ProfileResponse | null>;
  /**
   * Upsert the user's Profile, then persist every extracted entity under it,
   * preserving provenance. Returns the profile id + the persisted entities
   * (with their generated ids) for the response echo.
   */
  importEntities(userId: string, entities: ParsedEntity[]): Promise<ProfileImportResult>;
  /** Update only a fact owned by the verified user's profile; null hides cross-user ids. */
  updateFact(
    userId: string,
    factId: string,
    input: ProfileFactEditRequest,
  ): Promise<ProfileFactUpdateResult | null>;
}

// STUB(M01/M02): in-memory fake used by DB-free unit tests. Mirrors the Prisma
// store's scoping contract: one profile per user, entities attached to it.
export class InMemoryProfileRepo implements ProfileRepo {
  private readonly profileByUser = new Map<string, string>();
  /** profileId → persisted entities (with their assigned ids). */
  private readonly entitiesByProfile = new Map<string, InMemoryProfileFact[]>();
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

  updateFact(
    userId: string,
    factId: string,
    input: ProfileFactEditRequest,
  ): Promise<ProfileFactUpdateResult | null> {
    const profileId = this.profileByUser.get(userId);
    if (!profileId) return Promise.resolve(null);
    const entities = this.entitiesByProfile.get(profileId) ?? [];
    const index = entities.findIndex((entity) => entity.id === factId && entity.kind === input.kind);
    if (index < 0) return Promise.resolve(null);
    const existing = entities[index]!;
    const updated: InMemoryProfileFact = {
      ...existing,
      name: input.label,
      provenance: 'user',
    };
    entities[index] = updated;
    return Promise.resolve({
      profileId,
      beforeLabel: existing.name,
      fact: {
        id: updated.id,
        kind: updated.kind,
        label: updated.name,
        detail: updated.detail ?? null,
        provenance: 'user',
      },
    });
  }

  findByUserId(_userId: string): Promise<ProfileResponse | null> {
    return Promise.resolve(null);
  }

  /** Test helper: everything persisted for a user (asserts scoping). */
  dump(userId: string): InMemoryProfileFact[] {
    const pid = this.profileByUser.get(userId);
    return pid ? (this.entitiesByProfile.get(pid) ?? []) : [];
  }
}
