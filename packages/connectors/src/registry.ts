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

/**
 * ADR-002: M04 launch source set — Greenhouse + Lever public ATS APIs plus the
 * USAJobs government open feed. All three are free, no-contract, no-scraping.
 * The connector allow-list is EXACTLY these keys; anything else is blocked at
 * the guarded-fetch layer with `source_not_allowed` (milestone-04 acceptance).
 *
 * Rate policies are conservative M04 defaults; the ingestion worker enforces
 * them per-source via Redis (STUB(M01) — actual enforcement lands with the
 * worker wiring).
 */
export const M04_SOURCE_REGISTRY_SEED: readonly SourceRegistryEntry[] = [
  {
    key: 'greenhouse',
    type: 'ats_public',
    enabled: true,
    hosts: ['boards-api.greenhouse.io'],
    ratePolicy: { requestsPerMinute: 30 },
    mapping: null,
  },
  {
    key: 'lever',
    type: 'ats_public',
    enabled: true,
    hosts: ['api.lever.co'],
    ratePolicy: { requestsPerMinute: 30 },
    mapping: null,
  },
  {
    key: 'usajobs',
    type: 'gov_feed',
    enabled: true,
    hosts: ['data.usajobs.gov'],
    // USAJobs publishes 500 req/min for authenticated clients; we throttle
    // hard for hygiene (they're a government feed we don't want to hammer).
    ratePolicy: { requestsPerMinute: 20 },
    mapping: null,
  },
];

