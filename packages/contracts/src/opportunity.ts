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

/** Strict list projection emitted by GET /v1/opportunities. */
export const opportunityListItemSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    sourceRef: z.string().min(1),
    company: z.string().min(1),
    role: z.string().min(1),
    comp: z.record(z.string(), z.unknown()).nullable(),
    location: z.string().nullable(),
    remote: z.boolean().nullable(),
    ingestedAt: z.string().datetime(),
  })
  .strict();
export type OpportunityListItem = z.infer<typeof opportunityListItemSchema>;

/** Canonical pagination envelope; the backend calls the collection `data`. */
export const opportunityListResponseSchema = z
  .object({
    data: z.array(opportunityListItemSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type OpportunityListResponse = z.infer<typeof opportunityListResponseSchema>;

/** Detail-only fields are deliberately separate from the stored/internal shape. */
export const opportunityDetailSchema = opportunityListItemSchema
  .extend({
    requirementsParsed: z.record(z.string(), z.unknown()).nullable(),
    rawPayload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type OpportunityDetail = z.infer<typeof opportunityDetailSchema>;

export const opportunityMatchSubscoreSchema = z
  .object({ key: z.string().min(1), value: z.number().min(0).max(100) })
  .strict();

/**
 * Strict public projection for GET /v1/opportunities/:id/match.
 *
 * A DISCRIMINATED UNION on `status`:
 *   - `ok`                — a grounded rubric fit (overall + subscores +
 *                           explanation + evidenceRefs). This is the honest fit
 *                           even when LOW; a clearly-bad but ASSESSABLE match is a
 *                           low `ok`, never `insufficient_data`.
 *   - `insufficient_data` — too little of the caller's profile evidences this
 *                           role's requirements to assess fit; the API refuses to
 *                           invent a number and returns a plain-language `reason`.
 *
 * There is deliberately NO continuous confidence field — a fit score is a grounded
 * rubric, not a probability.
 *
 * Persistence identifiers (`match_scores.id` and `profile_id`) are deliberately
 * not transported. Internal scorer/store models retain those concerns in their
 * own package-local types; this schema models only the API response.
 */
export const opportunityMatchOkSchema = z
  .object({
    status: z.literal('ok'),
    opportunityId: z.string().min(1),
    overall: z.number().int().min(0).max(100),
    subscores: z.array(opportunityMatchSubscoreSchema),
    explanation: z.string(),
    evidenceRefs: z.array(z.string()),
    modelVersion: z.string().min(1).optional(),
  })
  .strict();
export type OpportunityMatchOk = z.infer<typeof opportunityMatchOkSchema>;

export const opportunityMatchInsufficientSchema = z
  .object({
    status: z.literal('insufficient_data'),
    opportunityId: z.string().min(1),
    reason: z.string().min(1),
    modelVersion: z.string().min(1).optional(),
  })
  .strict();
export type OpportunityMatchInsufficient = z.infer<typeof opportunityMatchInsufficientSchema>;

export const opportunityMatchResponseSchema = z.discriminatedUnion('status', [
  opportunityMatchOkSchema,
  opportunityMatchInsufficientSchema,
]);
export type OpportunityMatchResponse = z.infer<typeof opportunityMatchResponseSchema>;

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
