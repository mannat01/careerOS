import type { AuditRecord, AuditSink } from '@careeros/observability';
import type { PrismaClient } from '@prisma/client';

/**
 * Prisma-backed AuditSink — append-only.
 * No update/delete paths exist; immutability is enforced at the DB level
 * (no application code issues UPDATE or DELETE on audit_log).
 */
export class PrismaAuditSink implements AuditSink {
  constructor(private readonly prisma: PrismaClient) {}

  async append(record: AuditRecord): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        id: record.id,
        userId: record.userId,
        actor: record.actor as 'user' | 'twin' | 'system',
        action: record.action,
        target: record.target,
        reason: record.reason,
        modelVersion: record.modelVersion,
        traceId: record.traceId,
        at: new Date(record.at),
      },
    });
  }
}