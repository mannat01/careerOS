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
    try {
      await this.prisma.auditLog.create({
        data: {
          id: record.id,
          userId: record.userId,
          actor: record.actor,
          action: record.action,
          target: record.target,
          reason: record.reason,
          modelVersion: record.modelVersion,
          traceId: record.traceId,
          at: new Date(record.at),
        },
      });
    } catch (err: unknown) {
      // P2003 = FK violation: the user was hard-deleted (privacy cascade removes
      // their audit trail by design). Post-deletion decisions (e.g. a replayed
      // approval token) cannot be attributed to a row that no longer exists —
      // drop rather than fail the request path.
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'P2003') {
        return;
      }
      throw err;
    }
  }
}