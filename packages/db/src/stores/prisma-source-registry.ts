import type { SourceRegistryEntry } from '@careeros/contracts';
import type { PrismaClient } from '@prisma/client';

/**
 * Prisma-backed SourceRegistry (read-only for application code).
 * Writes happen only via seed/migration; the registry is a global allow-list.
 */
export class PrismaSourceRegistry {
  constructor(private readonly prisma: PrismaClient) {}

  async getByKey(key: string): Promise<SourceRegistryEntry | null> {
    const row = await this.prisma.sourceRegistry.findUnique({ where: { key } });
    if (!row) return null;
    return this.toEntry(row);
  }

  async findEnabledByHost(host: string): Promise<SourceRegistryEntry | null> {
    const needle = host.toLowerCase();
    const rows = await this.prisma.sourceRegistry.findMany({ where: { enabled: true } });
    for (const row of rows) {
      const hosts = row.hosts as string[];
      if (hosts.some((h: string) => h.toLowerCase() === needle)) {
        return this.toEntry(row);
      }
    }
    return null;
  }

  async listEnabled(): Promise<SourceRegistryEntry[]> {
    const rows = await this.prisma.sourceRegistry.findMany({ where: { enabled: true } });
    return rows.map((r) => this.toEntry(r));
  }

  private toEntry(row: {
    key: string;
    type: string;
    enabled: boolean;
    hosts: unknown;
    ratePolicy: unknown;
    mapping: unknown;
  }): SourceRegistryEntry {
    return {
      key: row.key,
      type: row.type as SourceRegistryEntry['type'],
      enabled: row.enabled,
      hosts: row.hosts as string[],
      ratePolicy: row.ratePolicy as Record<string, unknown> | null,
      mapping: row.mapping as Record<string, unknown> | null,
    };
  }
}