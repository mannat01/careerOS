import type { PrismaClient } from '@prisma/client';

/**
 * M07 — read-side projection over the immutable audit log. The write side
 * (PrismaAuditSink) is the ONLY code that inserts; nothing UPDATEs or DELETEs
 * an audit row. This store is READ-ONLY: page rows for one user, newest-first.
 *
 * The apps/api handler depends on the structural shape below (AuditReadPort in
 * apps/api), so @careeros/db never depends on apps/api.
 */

export interface AuditRowLike {
  id: string;
  userId: string;
  actor: 'user' | 'twin' | 'system';
  action: string;
  target: string | null;
  reason: string;
  modelVersion: string | null;
  traceId: string | null;
  at: string;
}

export interface AuditReadPortShape {
  listForUser(
    userId: string,
    input: { limit: number; before?: string | undefined },
  ): Promise<{ data: AuditRowLike[]; nextBefore: string | null }>;
}

export class PrismaAuditReadStore implements AuditReadPortShape {
  constructor(private readonly prisma: PrismaClient) {}

  async listForUser(
    userId: string,
    input: { limit: number; before?: string | undefined },
  ): Promise<{ data: AuditRowLike[]; nextBefore: string | null }> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        userId,
        ...(input.before !== undefined ? { at: { lt: new Date(input.before) } } : {}),
      },
      orderBy: { at: 'desc' },
      // Fetch limit+1 so we know if there's a next page without a count query.
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];
    return {
      data: page.map((r) => ({
        id: r.id,
        userId: r.userId,
        actor: r.actor,
        action: r.action,
        target: r.target ?? null,
        reason: r.reason,
        modelVersion: r.modelVersion ?? null,
        traceId: r.traceId ?? null,
        at: r.at.toISOString(),
      })),
      nextBefore: hasMore && last ? last.at.toISOString() : null,
    };
  }
}