/**
 * SourceRegistry seed — ADR-002: M01 ships with EXACTLY ONE enabled source
 * (Greenhouse public board API). Mirrors packages/connectors M01_SOURCE_REGISTRY_SEED.
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
];
