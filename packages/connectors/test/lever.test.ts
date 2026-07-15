import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { opportunitySchema } from '@careeros/contracts';
import {
  createGuardedFetch,
  InMemorySourceRegistry,
  LeverConnector,
  LEVER_API_HOST,
  M04_SOURCE_REGISTRY_SEED,
  type HttpTransport,
} from '../src/index.js';

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/lever/fixtures/lever-postings.json',
);
const fixture: unknown = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
const NOW = '2026-07-14T12:00:00.000Z';

const connector = new LeverConnector({ site: 'acmecorp', companyName: 'Acme Corp' });

describe('lever adapter → canonical Opportunity', () => {
  it('normalizes the committed fixture to schema-valid opportunities', () => {
    const opps = connector.normalize(fixture, NOW);
    expect(opps).toHaveLength(3);
    for (const opp of opps) {
      // Every Opportunity crosses the contract at the boundary.
      expect(opportunitySchema.parse(opp)).toEqual(opp);
      expect(opp.source).toBe('lever');
      expect(opp.company).toBe('Acme Corp');
      expect(opp.ingestedAt).toBe(NOW);
    }
    expect(opps[0]).toMatchObject({
      sourceRef: 'b7a1f8e2-0000-4a10-9d8a-11c0e5f00001',
      role: 'Senior Backend Engineer',
      location: 'Remote - US',
      remote: true,
    });
    expect(opps[0]?.comp).toEqual({ min: 180000, max: 240000, currency: 'USD', interval: 'annual' });
    // Product Designer is on-site and Lever gave us a null-min/null-max salary
    // range — our contract must treat that as `comp: null`, not a phantom range.
    expect(opps[2]).toMatchObject({
      sourceRef: 'b7a1f8e2-0000-4a10-9d8a-11c0e5f00003',
      role: 'Product Designer',
      location: 'New York, NY',
      remote: false,
      comp: null,
    });
  });

  it('sanitizes ingested description text: no HTML/entities survive; injection markers are flagged', () => {
    const opps = connector.normalize(fixture, NOW);
    const backend = opps[0]?.rawPayload as { descriptionSanitized: string; injectionFlags: string[] };
    expect(backend.descriptionSanitized).toContain('Senior Backend Engineer');
    expect(backend.descriptionSanitized).not.toMatch(/<[a-z/]/i);
    expect(backend.injectionFlags).toEqual([]);

    // ML fixture contains &lt;-encoded HTML plus an "ignore all previous instructions"
    // + exfiltration probe. Sanitizer must decode-then-strip and raise BOTH flags,
    // so downstream LLM steps know the raw payload was hostile.
    const ml = opps[1]?.rawPayload as { descriptionSanitized: string; injectionFlags: string[] };
    expect(ml.descriptionSanitized).not.toMatch(/<[a-z/]/i);
    expect(ml.injectionFlags).toContain('ignore_instructions');
    expect(ml.injectionFlags).toContain('system_prompt_probe');
  });

  it('rejects a malformed payload at the boundary (untrusted input)', () => {
    // Lever returns a bare array, so an object-shaped Greenhouse-style payload
    // must be rejected — never silently accepted.
    expect(() => connector.normalize({ postings: [] }, NOW)).toThrow();
    // Postings missing the mandatory `id` field must also be rejected.
    expect(() => connector.normalize([{ text: 'x', hostedUrl: 'not-a-url' }], NOW)).toThrow();
    // A non-JSON string must be rejected.
    expect(() => connector.normalize('<html>WAF page</html>', NOW)).toThrow();
  });

  it('fetches through the guarded layer against the sanctioned Lever host only', async () => {
    const transport: HttpTransport = (url) => {
      // Guarded fetch must resolve exactly to the ADR-002 Lever public host.
      expect(url.hostname).toBe(LEVER_API_HOST);
      expect(url.pathname).toBe('/v0/postings/acmecorp');
      expect(url.searchParams.get('mode')).toBe('json');
      return Promise.resolve({ status: 200, json: () => Promise.resolve(fixture) });
    };
    const guardedFetch = createGuardedFetch(
      new InMemorySourceRegistry([...M04_SOURCE_REGISTRY_SEED]),
      transport,
    );
    const raw = await connector.fetchRaw(guardedFetch);
    expect(connector.normalize(raw, NOW)).toHaveLength(3);
  });
});
