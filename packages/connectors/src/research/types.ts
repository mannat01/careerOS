/**
 * @careeros/connectors/research — sanctioned research source adapters (M07 Step 3).
 * Same allow-list discipline as the job connectors (packages/connectors/src/
 * greenhouse|lever|usajobs): every adapter goes through GuardedFetch, so a
 * non-allow-listed research host cannot be contacted — the guarded fetch layer
 * throws `source_not_allowed` before the transport is ever invoked.
 *
 * Adapters produce `NormalizedResearchFinding` — the normalized-at-boundary
 * shape the ingestion pipeline persists into `ResearchFinding` rows and the
 * graph-evidence linker projects into per-user `evidenced_by` edges.
 */
import type { GuardedFetch } from '../fetch.js';

/** The seven sanctioned research domains (mirrors ResearchFindingDomain enum). */
export type ResearchDomain =
  | 'hiring'
  | 'salary'
  | 'skills'
  | 'tech'
  | 'certs'
  | 'company'
  | 'industry';

/** Evidence strength — upper-bounds any synthesized insight's confidence. */
export type ResearchStrength = 'weak' | 'medium' | 'strong';

/**
 * A sanctioned research source registry entry. Absent or `enabled=false` ⇒
 * the guarded fetch layer blocks the host with `source_not_allowed`. Mirrors
 * the `ResearchSource` Prisma model in @careeros/db.
 */
export interface ResearchSourceEntry {
  key: string;
  domain: ResearchDomain;
  enabled: boolean;
  /** Exact hostnames the guarded fetch may contact for this source. */
  hosts: string[];
  ratePolicy: Record<string, unknown> | null;
  mapping: Record<string, unknown> | null;
}

/**
 * One normalized finding an adapter produces. `sourceRef` MUST be per-source
 * stable — together with `sourceKey` it uniquely identifies the finding, so
 * re-ingesting the same fixture upserts in place (no duplicate rows).
 *
 * `summary` is the SANITIZED short paraphrase surfaced to the synthesizer.
 * `entities` is the graph-linking payload the evidence linker uses to mint
 * `evidenced_by` edges on the per-user graph.
 */
export interface NormalizedResearchFinding {
  sourceKey: string;
  sourceRef: string;
  domain: ResearchDomain;
  summary: string;
  rawRef: {
    url: string;
    title?: string;
    publishedAt?: string;
    /** Downstream LLM steps must honor injection markers detected at ingest. */
    injectionFlags: string[];
  };
  entities: {
    skills: string[];
    companies: string[];
    industries: string[];
  };
  strength: ResearchStrength;
  observedAt: string;
}

/**
 * ResearchSourceAdapter contract — mirrors `SourceConnector` (the job side).
 * Every sanctioned research source implements this; adapters get a GuardedFetch
 * (never raw fetch), so the allow-list is enforced structurally.
 */
export interface ResearchSourceAdapter {
  readonly sourceKey: string;
  readonly domain: ResearchDomain;
  /** Fetch the raw payload through the guarded fetch layer (blocked if disallowed). */
  fetchRaw(fetcher: GuardedFetch): Promise<unknown>;
  /** Validate + sanitize UNTRUSTED raw payload into normalized findings. */
  normalize(raw: unknown, nowIso: string): NormalizedResearchFinding[];
}

/** Read-only research source registry (mirrors SourceRegistry surface). */
export interface ResearchSourceRegistry {
  getByKey(key: string): ResearchSourceEntry | null;
  findEnabledByHost(host: string): ResearchSourceEntry | null;
  listEnabled(): ResearchSourceEntry[];
  /** Ordered list of enabled source keys — the "allowed sources" for citation. */
  allowedSourceKeys(): string[];
}