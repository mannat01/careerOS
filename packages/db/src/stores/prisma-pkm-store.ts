import type { PrismaClient, PkmEntry as PrismaPkmEntry } from '@prisma/client';
import type { PkmCreateInput, PkmEntry, PkmStorePort, PkmUpdateInput } from '@careeros/cie-pkm';

function toEntry(row: PrismaPkmEntry): PkmEntry {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    body: row.body,
    tags: [...row.tags],
    provenance: 'user',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Every read and mutation includes userId in its predicate; cross-owner ids are absent. */
export class PrismaPkmStore implements PkmStorePort {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: PkmCreateInput): Promise<PkmEntry> {
    const row = await this.prisma.pkmEntry.create({ data: input });
    return toEntry(row);
  }

  async list(userId: string): Promise<PkmEntry[]> {
    const rows = await this.prisma.pkmEntry.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toEntry);
  }

  async get(userId: string, id: string): Promise<PkmEntry | null> {
    const row = await this.prisma.pkmEntry.findFirst({ where: { id, userId } });
    return row ? toEntry(row) : null;
  }

  async update(userId: string, id: string, input: PkmUpdateInput): Promise<PkmEntry | null> {
    const rows = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.pkmEntry.updateMany({ where: { id, userId }, data: input });
      if (changed.count === 0) return [];
      return tx.pkmEntry.findMany({ where: { id, userId }, take: 1 });
    });
    const row = rows[0];
    return row ? toEntry(row) : null;
  }

  async delete(userId: string, id: string): Promise<PkmEntry | null> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.pkmEntry.findFirst({ where: { id, userId } });
      if (!row) return null;
      const deleted = await tx.pkmEntry.deleteMany({ where: { id, userId } });
      return deleted.count === 1 ? toEntry(row) : null;
    });
  }
}