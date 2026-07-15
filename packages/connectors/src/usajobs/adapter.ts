import { z } from 'zod';
import { opportunitySchema, type Opportunity } from '@careeros/contracts';
import { computeDedupKey } from '../dedup.js';
import type { GuardedFetch } from '../fetch.js';
import { sanitizeUntrustedText } from '../sanitize.js';
import type { SourceConnector } from '../source-connector.js';

/**
 * USAJobs Search API adapter (ADR-002: the M04 government open-feed source,
 * alongside Greenhouse + Lever).
 *   GET https://data.usajobs.gov/api/search?Keyword=…&ResultsPerPage=…
 *
 * Auth: USAJobs requires `Authorization-Key` + `User-Agent` HEADERS on live
 * calls; those are attached by the ingestion worker's transport, NOT by this
 * adapter. This module stays a pure fixture-driven normalizer + guarded-fetch
 * caller (no secrets in tests; live fetch is manual/local behind the allow-list
 * per milestone-04 §Testing).
 *
 * The payload is UNTRUSTED — every free-text field is zod-validated then run
 * through `sanitizeUntrustedText` (strip markup, entities, control chars, flag
 * likely prompt-injection markers) BEFORE anything is stored or handed to an
 * LLM (coding-standards.md §1, milestone-04 §Security).
 */

export const USAJOBS_SOURCE_KEY = 'usajobs';
export const USAJOBS_API_HOST = 'data.usajobs.gov';

// USAJobs uses PascalCase JSON. We validate only the slice we consume; every
// other field is opaque untrusted data that never reaches an LLM.
const usaJobsPositionRemuneration = z
  .object({
    MinimumRange: z.string().nullish(),
    MaximumRange: z.string().nullish(),
    RateIntervalCode: z.string().nullish(),
    Description: z.string().nullish(),
  })
  .partial();

const usaJobsLocation = z
  .object({
    LocationName: z.string().nullish(),
    CountryCode: z.string().nullish(),
    CountrySubDivisionCode: z.string().nullish(),
    CityName: z.string().nullish(),
  })
  .partial();

const usaJobsPositionDescriptor = z.object({
  PositionID: z.string().min(1),
  PositionTitle: z.string().min(1),
  PositionURI: z.string().url(),
  ApplyURI: z.array(z.string().url()).nullish(),
  OrganizationName: z.string().min(1),
  DepartmentName: z.string().nullish(),
  PositionLocationDisplay: z.string().nullish(),
  PositionLocation: z.array(usaJobsLocation).nullish(),
  PositionRemuneration: z.array(usaJobsPositionRemuneration).nullish(),
  PublicationStartDate: z.string().nullish(),
  ApplicationCloseDate: z.string().nullish(),
  UserArea: z
    .object({
      Details: z
        .object({
          JobSummary: z.string().nullish(),
          MajorDuties: z.array(z.string()).nullish(),
          Requirements: z.string().nullish(),
          TeleworkEligible: z.boolean().nullish(),
        })
        .partial()
        .nullish(),
    })
    .partial()
    .nullish(),
});

const usaJobsSearchResultItem = z.object({
  MatchedObjectId: z.string().min(1),
  MatchedObjectDescriptor: usaJobsPositionDescriptor,
});

const usaJobsSearchResult = z.object({
  SearchResultItems: z.array(usaJobsSearchResultItem).default([]),
});

const usaJobsPayloadSchema = z.object({
  SearchResult: usaJobsSearchResult,
});

export interface UsaJobsConnectorOptions {
  /** Keyword query, e.g. "software engineer". Passed through URL encoding. */
  keyword: string;
  /** ResultsPerPage cap (USAJobs default 25, max 500). */
  resultsPerPage?: number;
}

/**
 * TELEWORK != REMOTE, but USAJobs' `TeleworkEligible` is the only structured
 * remote signal; treat true as "remote available" and false as "on-site".
 * Fall back to a scan of the display location as a secondary heuristic.
 */
function looksRemote(telework: boolean | null, locationDisplay: string | null): boolean | null {
  if (telework !== null) return telework;
  if (locationDisplay === null) return null;
  return /\bremote\b/i.test(locationDisplay);
}

export class UsaJobsConnector implements SourceConnector {
  readonly sourceKey = USAJOBS_SOURCE_KEY;

  constructor(private readonly opts: UsaJobsConnectorOptions) {}

  searchUrl(): string {
    const params = new URLSearchParams({ Keyword: this.opts.keyword });
    if (this.opts.resultsPerPage !== undefined) {
      params.set('ResultsPerPage', String(this.opts.resultsPerPage));
    }
    return `https://${USAJOBS_API_HOST}/api/search?${params.toString()}`;
  }

  async fetchRaw(fetcher: GuardedFetch): Promise<unknown> {
    const res = await fetcher(this.searchUrl());
    if (res.status !== 200) {
      throw new Error(`usajobs: unexpected status ${res.status} for keyword ${this.opts.keyword}`);
    }
    return res.json();
  }

  normalize(raw: unknown, nowIso: string): Opportunity[] {
    const payload = usaJobsPayloadSchema.parse(raw); // untrusted boundary
    return payload.SearchResult.SearchResultItems.map((item) => {
      const desc = item.MatchedObjectDescriptor;
      const locationDisplay = desc.PositionLocationDisplay ?? null;
      const telework = desc.UserArea?.Details?.TeleworkEligible ?? null;
      const summary = desc.UserArea?.Details?.JobSummary ?? '';
      const duties = (desc.UserArea?.Details?.MajorDuties ?? []).join('\n');
      const requirements = desc.UserArea?.Details?.Requirements ?? '';
      // Concatenate everything we'd expose to a scorer/LLM into ONE sanitized
      // blob — so a single sanitizer pass covers every free-text surface.
      const sanitized = sanitizeUntrustedText([summary, duties, requirements].filter(Boolean).join('\n\n'));

      const remuneration = (desc.PositionRemuneration ?? [])[0] ?? null;
      const comp =
        remuneration && (remuneration.MinimumRange || remuneration.MaximumRange)
          ? {
              min: remuneration.MinimumRange ?? null,
              max: remuneration.MaximumRange ?? null,
              rateIntervalCode: remuneration.RateIntervalCode ?? null,
              description: remuneration.Description ?? null,
            }
          : null;

      const opportunity: Opportunity = {
        source: this.sourceKey,
        sourceRef: item.MatchedObjectId,
        company: desc.OrganizationName,
        role: desc.PositionTitle,
        comp,
        location: locationDisplay,
        remote: looksRemote(telework, locationDisplay),
        requirementsParsed: null, // parsed later by the scoring pipeline
        rawPayload: {
          positionId: desc.PositionID,
          matchedObjectId: item.MatchedObjectId,
          positionUri: desc.PositionURI,
          applyUri: desc.ApplyURI ?? null,
          organizationName: desc.OrganizationName,
          departmentName: desc.DepartmentName ?? null,
          locationDisplay,
          teleworkEligible: telework,
          publicationStartDate: desc.PublicationStartDate ?? null,
          applicationCloseDate: desc.ApplicationCloseDate ?? null,
          descriptionSanitized: sanitized.text,
          descriptionTruncated: sanitized.truncated,
          injectionFlags: sanitized.injectionFlags, // downstream LLM steps must honor
        },
        dedupKey: computeDedupKey({
          company: desc.OrganizationName,
          role: desc.PositionTitle,
          location: locationDisplay,
        }),
        ingestedAt: nowIso,
      };
      // Contract-validate our own output before it crosses the package boundary.
      return opportunitySchema.parse(opportunity);
    });
  }
}
