import type { ApprovalTokenRecord, ApprovalTokenStore } from '@careeros/capability-gate';
import type { PrismaClient } from '@prisma/client';

/**
 * Prisma-backed ApprovalTokenStore.
 * consume() is atomic: UPDATE ... WHERE consumed_at IS NULL and checks affected rows.
 */
export class PrismaApprovalTokenStore implements ApprovalTokenStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(record: ApprovalTokenRecord): Promise<void> {
    await this.prisma.approvalToken.create({
      data: {
        id: record.id,
        userId: record.userId,
        action: record.action,
        payloadHash: record.payloadHash,
        expiresAt: new Date(record.expiresAt),
        consumedAt: null,
      },
    });
  }

  async findById(id: string): Promise<ApprovalTokenRecord | null> {
    const row = await this.prisma.approvalToken.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      action: row.action,
      payloadHash: row.payloadHash,
      expiresAt: row.expiresAt.getTime(),
      consumedAt: row.consumedAt?.getTime() ?? null,
    };
  }

  /**
   * Atomic consume: UPDATE approval_tokens SET consumed_at = $2
   * WHERE id = $1 AND consumed_at IS NULL.
   * If affected row count is 0, the token was already consumed or missing.
   */
  async consume(id: string, atMs: number): Promise<boolean> {
    const result = await this.prisma.$executeRaw`
      UPDATE approval_tokens
      SET consumed_at = ${new Date(atMs)}::timestamptz, updated_at = NOW()
      WHERE id = ${id}::uuid AND consumed_at IS NULL
    `;
    return result > 0;
  }
}