import type { MemoryService } from '@careeros/memory';
import type { ApplicationMemoryPort } from './application.handlers.js';

/**
 * Binds the application handler's narrow ApplicationMemoryPort to the four-tier
 * MemoryService (@careeros/memory). The handler never imports MemoryService or
 * @careeros/db directly — it depends only on ApplicationMemoryPort — so this
 * adapter is the single seam where the app wires memory into the pipeline flow.
 *
 * Every meaningful status change appends ONE append-only episodic MemoryEvent
 * recording WHAT moved (from→to on which opportunity) and WHO moved it (actor).
 * A user-driven change is a `user_decision`; a twin/system-driven change is a
 * `twin_action` — so the episodic history distinguishes what the human chose from
 * what an agent did. It never writes authoritative facts.
 */
export class ApplicationMemoryServiceAdapter implements ApplicationMemoryPort {
  constructor(private readonly memory: MemoryService) {}

  async recordStatusChange(input: {
    userId: string;
    applicationId: string;
    opportunityId: string;
    fromStatus: string;
    toStatus: string;
    actor: 'user' | 'twin' | 'system';
  }): Promise<void> {
    await this.memory.recordEvent({
      userId: input.userId,
      type: input.actor === 'user' ? 'user_decision' : 'twin_action',
      payload: {
        kind: 'application_status_change',
        applicationId: input.applicationId,
        opportunityId: input.opportunityId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        actor: input.actor,
      },
      rationale: `Application moved ${input.fromStatus} → ${input.toStatus} by ${input.actor}.`,
    });
  }
}
