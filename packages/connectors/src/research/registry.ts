/**
 * Sanctioned research source registry (M07 Step 3) — extends the SourceRegistry
 * allow-list discipline for research feeds. Absent or `enabled=false` sources
 * cannot be fetched: the guarded fetch layer blocks the host with
 * `source_not_allowed` before any transport is invoked.
 *
 * Kept in a SEPARATE registry from the job SourceRegistry so per-domain research
 * policy evolves independently from job-connector policy, while both share the
 * same guarded-fetch-layer contract.
 */
import type {
  ResearchSourceAdapter,
  ResearchSourceEntry,
  ResearchSourceRegistry,
} from './types.js';

export class ResearchSourceNotAllowedError extends Error {
  readonly code = 'source_not_allowed' as const;
  constructor(
    readonly host: string,
    detail: string,
  ) {
    super(`source_not_allowed: ${host} (${detail})`);
    this.name = 'ResearchSourceNotAllowedError';
  }
}

/** In-memory allow-list registry (stand-in for the Prisma-backed table in tests). */
export class InMemoryResearchSourceRegistry implements ResearchSourceRegistry {
  private readonly entries: Map<string, ResearchSourceEntry>;

  constructor(entries: readonly ResearchSourceEntry[]) {
    this.entries = new Map(
      entries.map((e) => [e.key, { ...e, hosts: [...e.hosts] }]),
    );
  }

  getByKey(key: string): ResearchSourceEntry | null {
    return this.entries.get(key) ?? null;
  }

  findEnabledByHost(host: string): ResearchSourceEntry | null {
    const needle = host.toLowerCase();
    for (const entry of this.entries.values()) {
      // Exact match only — subdomain look-alikes (attacker.com.host.com) must NOT pass.
      if (entry.enabled && entry.hosts.some((h) => h.toLowerCase() === needle)) return entry;
    }
    return null;
  }

  listEnabled(): ResearchSourceEntry[] {
    return [...this.entries.values()].filter((e) => e.enabled);
  }

  allowedSourceKeys(): string[] {
    return this.listEnabled().map((e) => e.key);
  }
}

/**
 * M07 seed — seven sanctioned research sources, one per domain. Live fetch
 * stays behind the guarded allow-list for local/manual runs; the fixture JSONs
 * committed under `research/fixtures/` are what tests ingest.
 */
export const M07_RESEARCH_SOURCE_SEED: readonly ResearchSourceEntry[] = [
  {
    key: 'bls-employment',
    domain: 'hiring',
    enabled: true,
    hosts: ['api.bls.gov'],
    ratePolicy: { requestsPerMinute: 10, dailyBudget: 250 },
    mapping: null,
  },
  {
    key: 'bls-oes',
    domain: 'salary',
    enabled: true,
    hosts: ['api.bls.gov'],
    ratePolicy: { requestsPerMinute: 10, dailyBudget: 250 },
    mapping: null,
  },
  {
    key: 'onet-skills',
    domain: 'skills',
    enabled: true,
    hosts: ['services.onetcenter.org'],
    ratePolicy: { requestsPerMinute: 20, dailyBudget: 1000 },
    mapping: null,
  },
  {
    key: 'arxiv-tech',
    domain: 'tech',
    enabled: true,
    hosts: ['export.arxiv.org'],
    ratePolicy: { requestsPerMinute: 3, dailyBudget: 100 },
    mapping: null,
  },
  {
    key: 'onet-certs',
    domain: 'certs',
    enabled: true,
    hosts: ['services.onetcenter.org'],
    ratePolicy: { requestsPerMinute: 20, dailyBudget: 1000 },
    mapping: null,
  },
  {
    key: 'sec-edgar',
    domain: 'company',
    enabled: true,
    hosts: ['data.sec.gov'],
    ratePolicy: { requestsPerMinute: 10, dailyBudget: 500 },
    mapping: null,
  },
  {
    key: 'bls-industry',
    domain: 'industry',
    enabled: true,
    hosts: ['api.bls.gov'],
    ratePolicy: { requestsPerMinute: 10, dailyBudget: 250 },
    mapping: null,
  },
];

/**
 * Given an adapter and a registry, return the primary host string the adapter
 * would try to contact — used by tests to demonstrate `source_not_allowed`
 * blocking for a non-allow-listed research host.
 */
export function primaryHostFor(
  adapter: ResearchSourceAdapter,
  registry: ResearchSourceRegistry,
): string | null {
  const entry = registry.getByKey(adapter.sourceKey);
  return entry?.hosts[0] ?? null;
}