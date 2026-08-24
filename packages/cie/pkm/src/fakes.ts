import type { PkmEntry } from './model.js';
import type { PkmCreateInput, PkmMemoryPort, PkmStorePort, PkmUpdateInput } from './ports.js';

let sequence = 0;

export class InMemoryPkmStore implements PkmStorePort {
  private readonly rows = new Map<string, PkmEntry>();

  create(input: PkmCreateInput): Promise<PkmEntry> {
    const now = new Date().toISOString();
    const entry: PkmEntry = {
      id: `00000000-0000-4000-8000-${(++sequence).toString().padStart(12, '0')}`,
      ...input,
      tags: [...input.tags],
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(entry.id, entry);
    return Promise.resolve({ ...entry, tags: [...entry.tags] });
  }

  list(userId: string): Promise<PkmEntry[]> {
    return Promise.resolve([...this.rows.values()]
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((entry) => ({ ...entry, tags: [...entry.tags] })));
  }

  get(userId: string, id: string): Promise<PkmEntry | null> {
    const entry = this.rows.get(id);
    return Promise.resolve(entry?.userId === userId ? { ...entry, tags: [...entry.tags] } : null);
  }

  update(userId: string, id: string, input: PkmUpdateInput): Promise<PkmEntry | null> {
    const entry = this.rows.get(id);
    if (!entry || entry.userId !== userId) return Promise.resolve(null);
    const updated: PkmEntry = {
      ...entry,
      ...input,
      ...(input.tags ? { tags: [...input.tags] } : {}),
      provenance: 'user',
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(id, updated);
    return Promise.resolve({ ...updated, tags: [...updated.tags] });
  }

  delete(userId: string, id: string): Promise<PkmEntry | null> {
    const entry = this.rows.get(id);
    if (!entry || entry.userId !== userId) return Promise.resolve(null);
    this.rows.delete(id);
    return Promise.resolve({ ...entry, tags: [...entry.tags] });
  }
}

export class InMemoryPkmMemory implements PkmMemoryPort {
  readonly events: Array<{ userId: string; entryId: string; action: 'created' | 'updated' | 'deleted' }> = [];

  recordMutation(input: { userId: string; entryId: string; action: 'created' | 'updated' | 'deleted' }): Promise<void> {
    this.events.push({ ...input });
    return Promise.resolve();
  }
}