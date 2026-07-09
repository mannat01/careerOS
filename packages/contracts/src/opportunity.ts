import { z } from 'zod';

/**
 * Canonical Opportunity shape — database-schema.md §2 (opportunity).
 * Global (not user-owned); deduped across sources by `dedupKey`.
 * `rawPayload` is UNTRUSTED ingested text: connectors sanitize before it is stored
 * or ever shown to an LLM (coding-standards.md §1).
 */
export const opportunitySchema = z.object({
  source: z.string().min(1), // fk → SourceRegistry.key
  sourceRef: z.string().min(1), // unique with source
  company: z.string().min(1),
  role: z.string().min(1),
  comp: z.record(z.unknown()).nullable(),
  location: z.string().nullable(),
  remote: z.boolean().nullable(),
  requirementsParsed: z.record(z.unknown()).nullable(),
  rawPayload: z.record(z.unknown()),
  dedupKey: z.string().min(1),
  ingestedAt: z.string().datetime(),
});
export type Opportunity = z.infer<typeof opportunitySchema>;

/** SourceRegistry entry (global allow-list) — database-schema.md §2 (connectors). */
export const sourceRegistryEntrySchema = z.object({
  key: z.string().min(1),
  type: z.enum(['ats_public', 'licensed_aggregator', 'gov_feed', 'user_oauth']),
  enabled: z.boolean(),
  /** Exact hostnames the fetch layer may contact for this source. */
  hosts: z.array(z.string().min(1)),
  ratePolicy: z.record(z.unknown()).nullable(),
  mapping: z.record(z.unknown()).nullable(),
});
export type SourceRegistryEntry = z.infer<typeof sourceRegistryEntrySchema>;
