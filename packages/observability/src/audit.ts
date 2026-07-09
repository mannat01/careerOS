import { randomUUID } from 'node:crypto';

/**
 * Audit client — CLAUDE.md §3.5 (auditability), database-schema.md (AuditLog).
 * Records are IMMUTABLE and append-only: the sink exposes no update/delete, and
 * records are frozen before they leave the client.
 */

export interface AuditRecord {
  id: string;
  userId: string;
  actor: 'user' | 'twin' | 'system';
  action: string;
  target: string | null;
  reason: string;
  modelVersion: string | null;
  traceId: string | null;
  /** ISO-8601 UTC */
  at: string;
}

export interface AuditRecordInput {
  userId: string;
  actor: 'user' | 'twin' | 'system';
  action: string;
  target?: string | null;
  reason: string;
  modelVersion?: string | null;
  traceId?: string | null;
}

/** Append-only persistence boundary. */
export interface AuditSink {
  append(record: AuditRecord): Promise<void>;
}

// STUB(M01): in-memory stand-in for the Prisma-backed `audit_log` table
// (append-only; deletion only via account hard-delete).
export class InMemoryAuditSink implements AuditSink {
  private readonly log: AuditRecord[] = [];

  append(record: AuditRecord): Promise<void> {
    this.log.push(Object.freeze({ ...record }));
    return Promise.resolve();
  }

  /** Read-only view for tests/audit UI; mutations to the copy do not affect the log. */
  records(): readonly AuditRecord[] {
    return [...this.log];
  }
}

export interface AuditClient {
  append(input: AuditRecordInput): Promise<AuditRecord>;
}

export function createAuditClient(deps: {
  sink: AuditSink;
  idFactory?: () => string;
  clock?: () => Date;
}): AuditClient {
  const idFactory = deps.idFactory ?? randomUUID;
  const clock = deps.clock ?? ((): Date => new Date());
  return {
    async append(input: AuditRecordInput): Promise<AuditRecord> {
      const record: AuditRecord = Object.freeze({
        id: idFactory(),
        userId: input.userId,
        actor: input.actor,
        action: input.action,
        target: input.target ?? null,
        reason: input.reason,
        modelVersion: input.modelVersion ?? null,
        traceId: input.traceId ?? null,
        at: clock().toISOString(),
      });
      await deps.sink.append(record);
      return record;
    },
  };
}
