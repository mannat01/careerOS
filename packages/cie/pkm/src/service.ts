import type { PkmEntry } from './model.js';
import type { PkmMemoryPort, PkmStorePort, PkmUpdateInput } from './ports.js';
import { normalizeTags } from './sanitize.js';

export interface PkmCreateBody {
  title: string;
  body: string;
  tags?: string[];
}

export interface PkmUpdateBody {
  title?: string;
  body?: string;
  tags?: string[];
}

export interface PkmServiceDeps {
  store: PkmStorePort;
  memory: PkmMemoryPort;
}

/** Caller-scoped PKM orchestration. Identity and provenance never come from input. */
export class PkmService {
  constructor(private readonly deps: PkmServiceDeps) {}

  async create(userId: string, input: PkmCreateBody): Promise<PkmEntry> {
    const entry = await this.deps.store.create({
      userId,
      title: input.title.trim(),
      body: input.body.trim(),
      tags: normalizeTags(input.tags),
      provenance: 'user',
    });
    await this.deps.memory.recordMutation({ userId, entryId: entry.id, action: 'created' });
    return entry;
  }

  list(userId: string): Promise<PkmEntry[]> {
    return this.deps.store.list(userId);
  }

  get(userId: string, id: string): Promise<PkmEntry | null> {
    return this.deps.store.get(userId, id);
  }

  async update(userId: string, id: string, input: PkmUpdateBody): Promise<PkmEntry | null> {
    const update: PkmUpdateInput = {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.body !== undefined ? { body: input.body.trim() } : {}),
      ...(input.tags !== undefined ? { tags: normalizeTags(input.tags) } : {}),
    };
    const entry = await this.deps.store.update(userId, id, update);
    if (!entry) return null;
    await this.deps.memory.recordMutation({ userId, entryId: entry.id, action: 'updated' });
    return entry;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const entry = await this.deps.store.delete(userId, id);
    if (!entry) return false;
    await this.deps.memory.recordMutation({ userId, entryId: entry.id, action: 'deleted' });
    return true;
  }
}