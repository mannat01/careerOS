import type { SourceRegistryEntry } from '@careeros/contracts';

/**
 * SourceRegistry allow-list — CLAUDE.md §3.3 (sanctioned sources only).
 * A source absent from the registry, or present but disabled, CANNOT be fetched.
 */

export class SourceNotAllowedError extends Error {
  readonly code = 'source_not_allowed' as const;
  constructor(
    readonly host: string,
    detail: string,
  ) {
    super(`source_not_allowed: ${host} (${detail})`);
    this.name = 'SourceNotAllowedError';
  }
}

export interface SourceRegistry {
  getByKey(key: string): SourceRegistryEntry | null;
  /** Exact hostname match against ENABLED sources only. */
  findEnabledByHost(host: string): SourceRegistryEntry | null;
  listEnabled(): SourceRegistryEntry[];
}

// STUB(M01): in-memory stand-in for the Prisma-backed `source_registry` table.
export class InMemorySourceRegistry implements SourceRegistry {
  private readonly entries: Map<string, SourceRegistryEntry>;

  constructor(entries: SourceRegistryEntry[]) {
    this.entries = new Map(entries.map((e) => [e.key, { ...e, hosts: [...e.hosts] }]));
  }

  getByKey(key: string): SourceRegistryEntry | null {
    return this.entries.get(key) ?? null;
  }

  findEnabledByHost(host: string): SourceRegistryEntry | null {
    const needle = host.toLowerCase();
    for (const entry of this.entries.values()) {
      // Exact match only — "boards-api.greenhouse.io.attacker.com" must NOT pass.
      if (entry.enabled && entry.hosts.some((h) => h.toLowerCase() === needle)) return entry;
    }
    return null;
  }

  listEnabled(): SourceRegistryEntry[] {
    return [...this.entries.values()].filter((e) => e.enabled);
  }
}

/**
 * ADR-002: M01 launches with exactly ONE enabled source — the Greenhouse public
 * board API (no-auth). Lever + USAJobs arrive in M04; anything else is blocked.
 */
export const M01_SOURCE_REGISTRY_SEED: readonly SourceRegistryEntry[] = [
  {
    key: 'greenhouse',
    type: 'ats_public',
    enabled: true,
    hosts: ['boards-api.greenhouse.io'],
    ratePolicy: { requestsPerMinute: 30 },
    mapping: null,
  },
];
