/**
 * FixtureResearchAdapter — the single adapter implementation the M07 sanctioned
 * research sources all use. It loads a per-source fixture JSON (committed under
 * `research/fixtures/`) and validates + sanitizes it into normalized findings.
 *
 * The adapter mirrors the job-connector shape: fetchRaw goes through GuardedFetch
 * (so `source_not_allowed` blocks non-allow-listed hosts BEFORE the transport is
 * invoked) and normalize does the untrusted-text sanitize + injection-flag pass.
 *
 * NO live network in tests. Live fetch stays behind the guarded allow-list for
 * local/manual runs — the fixture is what CI ingests.
 */
import { z } from 'zod';
import type { GuardedFetch } from '../fetch.js';
import { sanitizeUntrustedText } from '../sanitize.js';
import type {
  NormalizedResearchFinding,
  ResearchDomain,
  ResearchSourceAdapter,
} from './types.js';

// ---------------- fixture schema ----------------

const RECORD_SCHEMA = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  title: z.string().optional(),
  publishedAt: z.string().optional(),
  summary: z.string().min(1),
  entities: z
    .object({
      skills: z.array(z.string()).default([]),
      companies: z.array(z.string()).default([]),
      industries: z.array(z.string()).default([]),
    })
    .default({ skills: [], companies: [], industries: [] }),
  strength: z.enum(['weak', 'medium', 'strong']).default('medium'),
});

const FIXTURE_SCHEMA = z.object({
  sourceKey: z.string().min(1),
  domain: z.enum(['hiring', 'salary', 'skills', 'tech', 'certs', 'company', 'industry']),
  fetchedAt: z.string().min(1),
  /** The primary host the adapter uses when doing a live fetch. */
  records: z.array(RECORD_SCHEMA),
});

export type ResearchFixture = z.infer<typeof FIXTURE_SCHEMA>;

// ---------------- fixture adapter ----------------

export interface FixtureAdapterOptions {
  sourceKey: string;
  domain: ResearchDomain;
  /** Sample URL for the live-fetch guarded-fetch pass (allow-list demonstration). */
  liveFetchUrl: string;
  /** The pre-loaded fixture payload — the same JSON the tests ingest. */
  fixture: unknown;
}

export class FixtureResearchAdapter implements ResearchSourceAdapter {
  readonly sourceKey: string;
  readonly domain: ResearchDomain;
  private readonly liveFetchUrl: string;
  private readonly fixture: ResearchFixture;

  constructor(opts: FixtureAdapterOptions) {
    const parsed = FIXTURE_SCHEMA.parse(opts.fixture);
    if (parsed.sourceKey !== opts.sourceKey) {
      throw new Error(
        `fixture sourceKey mismatch: expected ${opts.sourceKey}, got ${parsed.sourceKey}`,
      );
    }
    if (parsed.domain !== opts.domain) {
      throw new Error(
        `fixture domain mismatch: expected ${opts.domain}, got ${parsed.domain}`,
      );
    }
    this.sourceKey = opts.sourceKey;
    this.domain = opts.domain;
    this.liveFetchUrl = opts.liveFetchUrl;
    this.fixture = parsed;
  }

  /**
   * Live-fetch entry point. Guarded by the allow-list — if the sanctioned host
   * has been disabled or removed, the guarded fetch layer throws
   * `source_not_allowed` before any HTTP is emitted. In tests this is called
   * with a fake transport that simply returns the fixture payload; the real
   * transport is only wired in local/manual runs.
   */
  async fetchRaw(fetcher: GuardedFetch): Promise<unknown> {
    const res = await fetcher(this.liveFetchUrl);
    if (res.status !== 200) {
      throw new Error(`research fetch failed: ${this.sourceKey} status=${res.status}`);
    }
    return res.json();
  }

  /**
   * Validate + sanitize the fixture into normalized findings.
   *
   * UNTRUSTED text discipline: each record's summary is passed through the same
   * `sanitizeUntrustedText` used by the job connectors — HTML/tags stripped,
   * control chars removed, injection markers flagged. Any detected injection
   * flags are carried on `rawRef.injectionFlags` so downstream LLM steps can
   * refuse to follow embedded instructions.
   */
  normalize(raw: unknown, nowIso: string): NormalizedResearchFinding[] {
    const parsed = FIXTURE_SCHEMA.parse(raw);
    if (parsed.sourceKey !== this.sourceKey || parsed.domain !== this.domain) {
      throw new Error(
        `normalize: fixture mismatch for ${this.sourceKey} (${this.domain})`,
      );
    }
    return parsed.records.map((r) => {
      const clean = sanitizeUntrustedText(r.summary, 4000);
      const sanitizedTitle = r.title ? sanitizeUntrustedText(r.title, 500).text : undefined;
      return {
        sourceKey: this.sourceKey,
        sourceRef: r.id,
        domain: this.domain,
        summary: clean.text,
        rawRef: {
          url: r.url,
          title: sanitizedTitle,
          publishedAt: r.publishedAt,
          injectionFlags: clean.injectionFlags,
        },
        entities: {
          skills: r.entities.skills.map((s) => s.toLowerCase().trim()).filter(Boolean),
          companies: r.entities.companies.map((s) => s.toLowerCase().trim()).filter(Boolean),
          industries: r.entities.industries.map((s) => s.toLowerCase().trim()).filter(Boolean),
        },
        strength: r.strength,
        observedAt: r.publishedAt ?? parsed.fetchedAt ?? nowIso,
      };
    });
  }
}