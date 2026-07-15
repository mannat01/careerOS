/**
 * SourceRegistry seed — ADR-002. M01 shipped with exactly one enabled source
 * (Greenhouse). M04 (§Deliverables) opens the allow-list to the launch source
 * set: Greenhouse + Lever public ATS APIs plus USAJobs (government open feed).
 * Mirrors packages/connectors M04_SOURCE_REGISTRY_SEED so the guarded-fetch
 * layer (which reads through PrismaSourceRegistry) and the in-memory registry
 * used by unit tests both agree on the same allow-list.
 */
export interface SourceRegistrySeedRow {
  key: string;
  type: 'ats_public' | 'licensed_aggregator' | 'gov_feed' | 'user_oauth';
  enabled: boolean;
  hosts: string[];
  ratePolicy: Record<string, unknown> | null;
  mapping: Record<string, unknown> | null;
}

export const SOURCE_REGISTRY_SEED: readonly SourceRegistrySeedRow[] = [
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
    ratePolicy: { requestsPerMinute: 20 },
    mapping: null,
  },
];
