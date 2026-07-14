/**
 * In-memory ResumeModel / ResumeVariant stores + a sequential id generator — the
 * DB-free doubles used by unit tests and the API composition root until the
 * Prisma-backed adapters land. PER-USER scoped: a variant is only ever readable
 * by the user it was saved for (proves the endpoint scoping without Postgres).
 */
import type { ResumeIdGen, ResumeModelStore, ResumeVariantStore } from './service.js';
import type { ResumeModel, ResumeVariant } from './model.js';

export class InMemoryResumeModelStore implements ResumeModelStore {
  private readonly baseByProfile = new Map<string, ResumeModel>();

  loadBase(profileId: string): Promise<ResumeModel | null> {
    const m = this.baseByProfile.get(profileId);
    return Promise.resolve(m ? structuredClone(m) : null);
  }

  save(model: ResumeModel): Promise<ResumeModel> {
    if (model.base) this.baseByProfile.set(model.profileId, structuredClone(model));
    return Promise.resolve(structuredClone(model));
  }
}

export class InMemoryResumeVariantStore implements ResumeVariantStore {
  /** key = `${userId}:${variantId}` — enforces per-user read scoping. */
  private readonly byKey = new Map<string, ResumeVariant>();

  save(userId: string, variant: ResumeVariant): Promise<ResumeVariant> {
    this.byKey.set(`${userId}:${variant.id}`, structuredClone(variant));
    return Promise.resolve(structuredClone(variant));
  }

  load(userId: string, variantId: string): Promise<ResumeVariant | null> {
    const v = this.byKey.get(`${userId}:${variantId}`);
    return Promise.resolve(v ? structuredClone(v) : null);
  }
}

/** Deterministic, monotonic id generator (`prefix-1`, `prefix-2`, …). */
export class SequentialIdGen implements ResumeIdGen {
  private readonly counters = new Map<string, number>();

  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}-${n}`;
  }
}
