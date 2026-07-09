import { z } from 'zod';
import { opportunitySchema, type Opportunity } from '@careeros/contracts';
import { computeDedupKey } from '../dedup.js';
import type { GuardedFetch } from '../fetch.js';
import { sanitizeUntrustedText } from '../sanitize.js';
import type { SourceConnector } from '../source-connector.js';

/**
 * Greenhouse Job Board public API adapter (ADR-002: the single M01 source).
 * Endpoint shape: GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true
 * The payload is UNTRUSTED: zod-validated, then all free text sanitized.
 */

export const GREENHOUSE_SOURCE_KEY = 'greenhouse';
export const GREENHOUSE_API_HOST = 'boards-api.greenhouse.io';

/** Tolerant-but-typed schema for the slice of the payload we consume. */
const greenhouseJobSchema = z.object({
  id: z.number().int(),
  title: z.string().min(1),
  updated_at: z.string(),
  absolute_url: z.string().url(),
  location: z.object({ name: z.string() }).nullish(),
  content: z.string().default(''),
});

const greenhouseJobsPayloadSchema = z.object({
  jobs: z.array(greenhouseJobSchema),
});

export interface GreenhouseConnectorOptions {
  /** Greenhouse board token, e.g. "acmecorp". */
  boardToken: string;
  /** Company display name for the canonical Opportunity. */
  companyName: string;
}

function looksRemote(locationName: string | null): boolean | null {
  if (locationName === null) return null;
  return /\bremote\b/i.test(locationName) ? true : false;
}

export class GreenhouseConnector implements SourceConnector {
  readonly sourceKey = GREENHOUSE_SOURCE_KEY;

  constructor(private readonly opts: GreenhouseConnectorOptions) {}

  jobsUrl(): string {
    return `https://${GREENHOUSE_API_HOST}/v1/boards/${encodeURIComponent(this.opts.boardToken)}/jobs?content=true`;
  }

  async fetchRaw(fetcher: GuardedFetch): Promise<unknown> {
    const res = await fetcher(this.jobsUrl());
    if (res.status !== 200) {
      throw new Error(`greenhouse: unexpected status ${res.status} for board ${this.opts.boardToken}`);
    }
    return res.json();
  }

  normalize(raw: unknown, nowIso: string): Opportunity[] {
    const payload = greenhouseJobsPayloadSchema.parse(raw); // untrusted boundary
    return payload.jobs.map((job) => {
      const location = job.location?.name ?? null;
      const sanitized = sanitizeUntrustedText(job.content);
      const opportunity: Opportunity = {
        source: this.sourceKey,
        sourceRef: String(job.id),
        company: this.opts.companyName,
        role: job.title,
        comp: null, // Greenhouse public board API carries no comp data
        location,
        remote: looksRemote(location),
        requirementsParsed: null, // parsing is an M04 (scorer) concern
        rawPayload: {
          id: job.id,
          title: job.title,
          updatedAt: job.updated_at,
          absoluteUrl: job.absolute_url,
          locationName: location,
          contentSanitized: sanitized.text,
          contentTruncated: sanitized.truncated,
          injectionFlags: sanitized.injectionFlags, // downstream LLM steps must honor these
        },
        dedupKey: computeDedupKey({ company: this.opts.companyName, role: job.title, location }),
        ingestedAt: nowIso,
      };
      // Contract-validate our own output before it crosses the package boundary.
      return opportunitySchema.parse(opportunity);
    });
  }
}
