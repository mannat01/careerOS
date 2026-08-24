import type { MemoryService } from '@careeros/memory';
import type { PkmMemoryPort } from '@careeros/cie-pkm';

/** Records each successful PKM mutation as one append-only user-decision MemoryEvent. */
export class PkmMemoryServiceAdapter implements PkmMemoryPort {
  constructor(private readonly memory: MemoryService) {}

  async recordMutation(input: {
    userId: string;
    entryId: string;
    action: 'created' | 'updated' | 'deleted';
  }): Promise<void> {
    await this.memory.recordEvent({
      userId: input.userId,
      type: 'user_decision',
      payload: {
        kind: 'pkm_entry_mutation',
        entryId: input.entryId,
        action: input.action,
        provenance: 'user',
      },
      autonomyTier: 'green',
      rationale: `PKM entry ${input.entryId} ${input.action} by its owner.`,
    });
  }
}