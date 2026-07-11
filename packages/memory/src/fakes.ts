import type {
  DerivedInsight,
  DerivedInsightInput,
  EpisodicStore,
  MemoryEvent,
  MemoryEventInput,
  ProfileFact,
  ProfileReader,
  SemanticStore,
} from './types.js';

/**
 * In-memory tier stores — DB-free doubles usable by unit tests AND by any caller
 * that wants a non-persistent MemoryService. They encode the SAME contracts the
 * Prisma adapters must honor:
 *   - InMemoryEpisodicStore is APPEND-ONLY: it exposes append()/read() and
 *     deliberately has NO update/delete surface, matching the DB immutability
 *     contract (removal only via account hard-delete, simulated here by dropping
 *     the whole instance).
 *   - InMemorySemanticStore.replaceAll drops+rebuilds a profile's insights, which
 *     is exactly how regenerate() stays non-authoritative (it never touches facts).
 */

let seq = 0;
const nextId = (): string => `mem-${(++seq).toString().padStart(6, '0')}`;

export class InMemoryProfileReader implements ProfileReader {
  private readonly facts: Map<string, ProfileFact[]> = new Map();

  constructor(initial: Record<string, ProfileFact[]> = {}) {
    for (const [userId, facts] of Object.entries(initial)) {
      this.facts.set(userId, [...facts]);
    }
  }

  setFacts(userId: string, facts: ProfileFact[]): void {
    this.facts.set(userId, [...facts]);
  }

  readFacts(userId: string): Promise<ProfileFact[]> {
    return Promise.resolve([...(this.facts.get(userId) ?? [])]);
  }
}

export class InMemoryEpisodicStore implements EpisodicStore {
  private readonly events: MemoryEvent[] = [];
  private clock = 0;

  append(event: MemoryEventInput): Promise<MemoryEvent> {
    // Monotonic timestamps keep most-recent-first ordering deterministic in tests.
    const occurredAt = new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock++)).toISOString();
    const row: MemoryEvent = {
      id: nextId(),
      userId: event.userId,
      type: event.type,
      payload: event.payload,
      ...(event.rationale !== undefined ? { rationale: event.rationale } : {}),
      ...(event.autonomyTier !== undefined ? { autonomyTier: event.autonomyTier } : {}),
      occurredAt,
    };
    this.events.push(row);
    return Promise.resolve(row);
  }

  read(userId: string, limit?: number): Promise<MemoryEvent[]> {
    const rows = this.events
      .filter((e) => e.userId === userId)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return Promise.resolve(limit === undefined ? rows : rows.slice(0, limit));
  }

  /** Test-only introspection; NOT part of EpisodicStore (no mutation exposed). */
  countFor(userId: string): number {
    return this.events.filter((e) => e.userId === userId).length;
  }
}

export class InMemorySemanticStore implements SemanticStore {
  private readonly byProfile: Map<string, DerivedInsight[]> = new Map();

  listByProfile(profileId: string): Promise<DerivedInsight[]> {
    return Promise.resolve([...(this.byProfile.get(profileId) ?? [])]);
  }

  replaceAll(profileId: string, insights: DerivedInsightInput[]): Promise<DerivedInsight[]> {
    const rows: DerivedInsight[] = insights.map((i) => ({
      id: nextId(),
      profileId: i.profileId,
      statement: i.statement,
      sourceRefs: [...i.sourceRefs],
      freshnessAt: i.freshnessAt,
      ...(i.modelVersion !== undefined ? { modelVersion: i.modelVersion } : {}),
    }));
    this.byProfile.set(profileId, rows);
    return Promise.resolve([...rows]);
  }
}
