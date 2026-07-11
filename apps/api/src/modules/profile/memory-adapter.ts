import type { MemoryService } from '@careeros/memory';
import type { MemoryEventPort } from './import.handlers.js';

/**
 * Binds the import handler's narrow MemoryEventPort to the four-tier
 * MemoryService (@careeros/memory). The handler never imports MemoryService or
 * @careeros/db directly — it depends only on MemoryEventPort — so this adapter is
 * the single seam where the app wires memory into the profile-import flow.
 *
 * Every import/edit appends ONE append-only episodic MemoryEvent recording WHAT
 * changed (counts + source) and WHY (a human-readable rationale the semantic tier
 * later distills from). It never writes authoritative facts — those live in the
 * profile tier.
 */
export class MemoryServiceEventAdapter implements MemoryEventPort {
  constructor(private readonly memory: MemoryService) {}

  async recordProfileImport(input: {
    userId: string;
    profileId: string;
    counts: { experiences: number; projects: number; education: number; skillClaims: number };
    source: 'resume_text' | 'entities';
  }): Promise<void> {
    const total =
      input.counts.experiences +
      input.counts.projects +
      input.counts.education +
      input.counts.skillClaims;

    await this.memory.recordEvent({
      userId: input.userId,
      type: 'user_decision',
      payload: {
        kind: 'profile_import',
        profileId: input.profileId,
        source: input.source,
        counts: input.counts,
      },
      rationale: `Imported ${total} profile fact(s) via ${input.source}.`,
    });
  }
}
