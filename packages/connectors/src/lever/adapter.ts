import { z } from 'zod';
import { opportunitySchema, type Opportunity } from '@careeros/contracts';
import { computeDedupKey } from '../dedup.js';
import type { GuardedFetch } from '../fetch.js';
import { sanitizeUntrustedText } from '../sanitize.js';
import type { SourceConnector } from '../source-connector.js';

/**
 * Lever public postings API adapter (ADR-002: M04 launch source alongside
 * Greenhouse and USAJobs). No-auth endpoint:
 *   GET https://api.lever.co/v0/postings/{site}?mode=json
 *
 * The payload is UNTRUSTED — every free-text field is zod-validated then run
 * through `sanitizeUntrustedText` (strip markup, entities, control chars, flag
 * likely prompt-injection markers) BEFORE anything is stored or handed to an
 * LLM (coding-standards.md §1, milestone-04 §Security).
 */

export const LEVER_SOURCE_KEY = 'lever';
export const LEVER_API_HOST = 'api.lever.co';

/**
 * Tolerant-but-typed schema for the slice of Lever's payload we consume. The
 * public JSON schema documents many more fields; we validate only the ones we
 * project onto the canonical Opportunity, and treat the rest as opaque untrusted
 * data (they never reach an LLM).
 */
const leverCategoriesSchema = z
  .object({
    team: z.string().nullish(),
    department: z.string().nullish(),
    location: z.string().nullish(),
    commitment: z.string().nullish(),
    // Additional Lever categories are ignored on purpose.
  })
  .partial();

const leverSalaryRangeSchema = z
  .object({
    min: z.number().nullish(),
    max: z.number().nullish(),
    currency: z.string().nullish(),
    interval: z.string().nullish(),
  })
  .nullish();

const leverPostingSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1), // job title
  hostedUrl: z.string().url(),
  applyUrl: z.string().url().nullish(),
  categories: leverCategoriesSchema.nullish(),
  createdAt: z.number().int().nullish(),
  updatedAt: z.number().int().nullish(),
  workplaceType: z.string().nullish(), // "remote" | "hybrid" | "on-site"
  descriptionPlain: z.string().nullish(),
  description: z.string().nullish(), // HTML
  salaryRange: leverSalaryRangeSchema,
});

/** Lever returns a bare array — NOT a wrapper object like Greenhouse. */
const leverPayloadSchema = z.array(leverPostingSchema);

export interface LeverConnectorOptions {
  /** Lever site slug (subdomain), e.g. "acmecorp" for acmecorp.lever.co. */
  site: string;
  /** Company display name for the canonical Opportunity. */
  companyName: string;
}

/**
 * Best-effort remote flag. Lever exposes both `workplaceType` and a categorized
 * `location` label; either one saying "remote" is authoritative. Returns null
 * only when NEITHER signal is present (unknown, not a false-negative).
 */
function looksRemote(workplaceType: string | null, locationName: string | null): boolean | null {
  if (workplaceType === null && locationName === null) return null;
  if (workplaceType !== null && workplaceType.toLowerCase() === 'remote') return true;
  if (locationName !== null && /\bremote\b/i.test(locationName)) return true;
  return false;
}

export class LeverConnector implements SourceConnector {
  readonly sourceKey = LEVER_SOURCE_KEY;

  constructor(private readonly opts: LeverConnectorOptions) {}

  postingsUrl(): string {
    return `https://${LEVER_API_HOST}/v0/postings/${encodeURIComponent(this.opts.site)}?mode=json`;
  }

  async fetchRaw(fetcher: GuardedFetch): Promise<unknown> {
    const res = await fetcher(this.postingsUrl());
    if (res.status !== 200) {
      throw new Error(`lever: unexpected status ${res.status} for site ${this.opts.site}`);
    }
    return res.json();
  }

  normalize(raw: unknown, nowIso: string): Opportunity[] {
    const postings = leverPayloadSchema.parse(raw); // untrusted boundary
    return postings.map((posting) => {
      const locationName = posting.categories?.location ?? null;
      const workplaceType = posting.workplaceType ?? null;
      // Prefer the plaintext when Lever provides it — it's already stripped of
      // markup and less noisy to sanitize; fall back to the HTML `description`.
      const rawDescription = posting.descriptionPlain ?? posting.description ?? '';
      const sanitized = sanitizeUntrustedText(rawDescription);

      const salaryRange = posting.salaryRange ?? null;
      // `comp` is a nullable JSON blob on the Opportunity contract; only stamp
      // it when Lever actually gave us salary numbers.
      const comp =
        salaryRange && (salaryRange.min != null || salaryRange.max != null)
          ? {
              min: salaryRange.min ?? null,
              max: salaryRange.max ?? null,
              currency: salaryRange.currency ?? null,
              interval: salaryRange.interval ?? null,
            }
          : null;

      const opportunity: Opportunity = {
        source: this.sourceKey,
        sourceRef: posting.id,
        company: this.opts.companyName,
        role: posting.text,
        comp,
        location: locationName,
        remote: looksRemote(workplaceType, locationName),
        requirementsParsed: null, // parsed later by the scoring pipeline
        rawPayload: {
          id: posting.id,
          title: posting.text,
          hostedUrl: posting.hostedUrl,
          applyUrl: posting.applyUrl ?? null,
          workplaceType,
          locationName,
          team: posting.categories?.team ?? null,
          department: posting.categories?.department ?? null,
          commitment: posting.categories?.commitment ?? null,
          createdAt: posting.createdAt ?? null,
          updatedAt: posting.updatedAt ?? null,
          descriptionSanitized: sanitized.text,
          descriptionTruncated: sanitized.truncated,
          injectionFlags: sanitized.injectionFlags, // downstream LLM steps must honor
        },
        dedupKey: computeDedupKey({
          company: this.opts.companyName,
          role: posting.text,
          location: locationName,
        }),
        ingestedAt: nowIso,
      };
      // Contract-validate our own output before it crosses the package boundary.
      return opportunitySchema.parse(opportunity);
    });
  }
}
