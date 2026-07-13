/**
 * In-memory StateStore — the DB-free double used by unit tests and any caller
 * that wants non-persistent state. PER-USER scoped: one user's model is never
 * visible to another. The Prisma-backed adapter in the app honors the same
 * contract against the `career_state_models` / `career_state_dimensions` tables.
 */
import type { CareerStateModel } from './model.js';
import type { StateStore } from './service.js';

export class InMemoryStateStore implements StateStore {
  private readonly byUser = new Map<string, CareerStateModel>();

  load(userId: string): Promise<CareerStateModel | null> {
    const m = this.byUser.get(userId);
    return Promise.resolve(m ? structuredClone(m) : null);
  }

  save(model: CareerStateModel): Promise<CareerStateModel> {
    // The store keys on the owning user; the model carries profileId. Tests set
    // profileId === userId or pass an explicit user key via saveFor.
    const key = model.profileId;
    this.byUser.set(key, structuredClone(model));
    return Promise.resolve(structuredClone(model));
  }
}
