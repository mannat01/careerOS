/**
 * M07 Step 3 — sanctioned research sources unit tests.
 *
 * Covers:
 *   1. FixtureResearchAdapter validates + sanitizes per-source fixtures.
 *   2. Untrusted-text sanitize discipline: HTML/tags stripped, injection markers
 *      surfaced as `injectionFlags` (same discipline as the M04 job connectors).
 *   3. Allow-list registry hostname resolution — allow-listed hosts pass,
 *      non-allow-listed hosts are rejected. Exact-match only (no subdomain
 *      look-alikes).
 *   4. Guarded fetch layer blocks a non-allow-listed research host with
 *      `source_not_allowed` BEFORE the transport is invoked.
 *   5. Ingestion pipeline: normalized findings are handed to the store port
 *      idempotently on (sourceKey, sourceRef); a disabled source is reported
 *      as `blocked` (not thrown), so a scheduler doesn't abort on one bad source.
 *   6. Fixtures + registry parity — every seed key has a fixture, every
 *      fixture has a matching seed entry.
 */
import { describe, expect, it } from 'vitest';
import {
  FixtureResearchAdapter,
  InMemoryResearchSourceRegistry,
  M07_RESEARCH_SOURCE_SEED,
  RESEARCH_FIXTURES,
  ResearchIngestionService,
  buildSanctionedResearchAdapters,
  createGuardedFetch,
  type NormalizedResearchFinding,
  type ResearchFindingStorePort,
} from '../src/index.js';

// ---------------- helpers ----------------

class FakeFindingStore implements ResearchFindingStorePort {
  readonly rows = new Map<string, NormalizedResearchFinding>();

  upsertMany(findings: NormalizedResearchFinding[]): Promise<{
    inserted: number;
    updated: number;
  }> {
    let inserted = 0;
    let updated = 0;
    for (const f of findings) {
      const key = `${f.sourceKey}::${f.sourceRef}`;
      if (this.rows.has(key)) updated += 1;
      else inserted += 1;
      this.rows.set(key, f);
    }
    return Promise.resolve({ inserted, updated });
  }
}

// A guarded fetch fixture transport: the "network" simply returns the fixture
// JSON for the URL the adapter was configured with. NO live network in tests.
// Maps each adapter's liveFetchUrl → its fixture (multiple adapters can share
// a host — e.g. api.bls.gov — so we match by full URL, not just hostname).
function makeFixtureTransport(): (url: URL) => Promise<{ status: number; json: () => Promise<unknown> }> {
  const urlToFixture = new Map<string, unknown>();
  // The seven adapter (liveFetchUrl, fixture-key) pairs — matches
  // buildSanctionedResearchAdapters() 1:1.
  const built: Array<{ liveFetchUrl: string; key: keyof typeof RESEARCH_FIXTURES }> = [
    { liveFetchUrl: 'https://api.bls.gov/publicAPI/v2/timeseries/data/CES0000000001', key: 'bls-employment' },
    { liveFetchUrl: 'https://api.bls.gov/publicAPI/v2/timeseries/data/OES15113200000000000004', key: 'bls-oes' },
    { liveFetchUrl: 'https://services.onetcenter.org/ws/online/occupations/15-1252.00/skills', key: 'onet-skills' },
    { liveFetchUrl: 'https://export.arxiv.org/api/query?search_query=cat:cs.AI', key: 'arxiv-tech' },
    { liveFetchUrl: 'https://services.onetcenter.org/ws/online/occupations/15-1252.00/certifications', key: 'onet-certs' },
    { liveFetchUrl: 'https://data.sec.gov/submissions/CIK0001234567.json', key: 'sec-edgar' },
    { liveFetchUrl: 'https://api.bls.gov/publicAPI/v2/timeseries/data/CES5000000001', key: 'bls-industry' },
  ];
  for (const b of built) urlToFixture.set(b.liveFetchUrl, RESEARCH_FIXTURES[b.key]);
  return (url: URL) => {
    const fixture = urlToFixture.get(url.toString());
    if (fixture) return Promise.resolve({ status: 200, json: () => Promise.resolve(fixture) });
    return Promise.resolve({ status: 404, json: () => Promise.resolve({}) });
  };
}

// ---------------- 1. adapter validates + sanitizes ----------------

describe('FixtureResearchAdapter', () => {
  it('normalizes each committed fixture into findings with sanitized summaries', () => {
    for (const adapter of buildSanctionedResearchAdapters()) {
      const raw = RESEARCH_FIXTURES[adapter.sourceKey as keyof typeof RESEARCH_FIXTURES];
      const findings = adapter.normalize(raw, '2026-07-01T00:00:00.000Z');
      expect(findings.length).toBeGreaterThan(0);
      for (const f of findings) {
        expect(f.sourceKey).toBe(adapter.sourceKey);
        expect(f.domain).toBe(adapter.domain);
        expect(f.summary).not.toContain('<script>');
        expect(f.summary.length).toBeGreaterThan(0);
        expect(f.rawRef.url).toMatch(/^https:\/\//);
      }
    }
  });

  it('flags prompt-injection markers on the industry fixture (rs-adversarial)', () => {
    const adapter = buildSanctionedResearchAdapters().find((a) => a.sourceKey === 'bls-industry')!;
    const findings = adapter.normalize(RESEARCH_FIXTURES['bls-industry'], '2026-07-01T00:00:00.000Z');
    const flagged = findings.find((f) => f.rawRef.injectionFlags.length > 0);
    expect(flagged).toBeDefined();
    expect(flagged!.rawRef.injectionFlags).toContain('ignore_instructions');
    // HTML markup must be stripped and never appear in the sanitized summary.
    expect(flagged!.summary).not.toContain('<script>');
    expect(flagged!.summary).not.toContain('</script>');
  });

  it('rejects a fixture whose sourceKey does not match the adapter', () => {
    expect(
      () =>
        new FixtureResearchAdapter({
          sourceKey: 'bls-oes',
          domain: 'salary',
          liveFetchUrl: 'https://api.bls.gov/x',
          fixture: RESEARCH_FIXTURES['bls-employment'],
        }),
    ).toThrow(/sourceKey mismatch/);
  });
});

// ---------------- 2. registry + allow-list discipline ----------------

describe('InMemoryResearchSourceRegistry', () => {
  const registry = new InMemoryResearchSourceRegistry(M07_RESEARCH_SOURCE_SEED);

  it('finds enabled sources by exact hostname', () => {
    expect(registry.findEnabledByHost('api.bls.gov')?.key).toBe('bls-employment');
    expect(registry.findEnabledByHost('services.onetcenter.org')?.key).toBe('onet-skills');
  });

  it('rejects subdomain look-alikes (exact match only)', () => {
    expect(registry.findEnabledByHost('api.bls.gov.attacker.com')).toBeNull();
    expect(registry.findEnabledByHost('evil-services.onetcenter.org')).toBeNull();
  });

  it('exposes the allowed source key list', () => {
    const keys = registry.allowedSourceKeys();
    expect(keys).toContain('bls-employment');
    expect(keys).toContain('sec-edgar');
    expect(keys.length).toBe(M07_RESEARCH_SOURCE_SEED.length);
  });
});

// ---------------- 3. guarded fetch blocks non-allow-listed research host ----------------

describe('guarded fetch — research allow-list', () => {
  it('blocks a non-allow-listed host with source_not_allowed BEFORE the transport is invoked', async () => {
    let transportCalled = false;
    const registry = new InMemoryResearchSourceRegistry(M07_RESEARCH_SOURCE_SEED);
    // Bridge to the job-connector guarded fetch shape (same contract).
    const guarded = createGuardedFetch(
      {
        getByKey: (k) => registry.getByKey(k) as never,
        findEnabledByHost: (h) => registry.findEnabledByHost(h) as never,
        listEnabled: () => registry.listEnabled() as never,
      },
      () => {
        transportCalled = true;
        return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
      },
    );
    await expect(guarded('https://attacker.example.com/leak')).rejects.toThrow(/source_not_allowed/);
    expect(transportCalled).toBe(false);
  });

  it('allows an allow-listed research host (exact match)', async () => {
    let ok = false;
    const registry = new InMemoryResearchSourceRegistry(M07_RESEARCH_SOURCE_SEED);
    const guarded = createGuardedFetch(
      {
        getByKey: (k) => registry.getByKey(k) as never,
        findEnabledByHost: (h) => registry.findEnabledByHost(h) as never,
        listEnabled: () => registry.listEnabled() as never,
      },
      () => {
        ok = true;
        return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
      },
    );
    const res = await guarded('https://api.bls.gov/publicAPI/v2/timeseries/data/X');
    expect(res.status).toBe(200);
    expect(ok).toBe(true);
  });
});

// ---------------- 4. ingestion — dedupe + block-not-throw ----------------

describe('ResearchIngestionService', () => {
  it('persists all fixtures once; re-ingest is a no-op on (sourceKey, sourceRef)', async () => {
    const registry = new InMemoryResearchSourceRegistry(M07_RESEARCH_SOURCE_SEED);
    const store = new FakeFindingStore();
    const guarded = createGuardedFetch(
      {
        getByKey: (k) => registry.getByKey(k) as never,
        findEnabledByHost: (h) => registry.findEnabledByHost(h) as never,
        listEnabled: () => registry.listEnabled() as never,
      },
      makeFixtureTransport(),
    );
    const svc = new ResearchIngestionService({ registry, guardedFetch: guarded, store });
    const adapters = buildSanctionedResearchAdapters();

    const first = await svc.ingest(adapters);
    expect(first.totalFindings).toBeGreaterThanOrEqual(14); // 7 sources × 2 records each
    expect(first.inserted).toBe(first.totalFindings);
    expect(first.updated).toBe(0);
    expect(first.blocked).toEqual([]);

    const second = await svc.ingest(adapters);
    expect(second.totalFindings).toBe(first.totalFindings);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(first.totalFindings);
  });

  it('reports a disabled source as blocked (does not throw)', async () => {
    const seed = M07_RESEARCH_SOURCE_SEED.map((e) =>
      e.key === 'sec-edgar' ? { ...e, enabled: false } : e,
    );
    const registry = new InMemoryResearchSourceRegistry(seed);
    const store = new FakeFindingStore();
    const guarded = createGuardedFetch(
      {
        getByKey: (k) => registry.getByKey(k) as never,
        findEnabledByHost: (h) => registry.findEnabledByHost(h) as never,
        listEnabled: () => registry.listEnabled() as never,
      },
      makeFixtureTransport(),
    );
    const svc = new ResearchIngestionService({ registry, guardedFetch: guarded, store });
    const result = await svc.ingest(buildSanctionedResearchAdapters());
    expect(result.blocked).toContainEqual({ sourceKey: 'sec-edgar', reason: 'source_not_allowed' });
    // Other sources still ingested.
    expect(result.bySource.find((s) => s.sourceKey === 'sec-edgar')).toBeUndefined();
    expect(result.bySource.length).toBe(M07_RESEARCH_SOURCE_SEED.length - 1);
  });

  it('surfaces injection flags on the ingestion result', async () => {
    const registry = new InMemoryResearchSourceRegistry(M07_RESEARCH_SOURCE_SEED);
    const store = new FakeFindingStore();
    const guarded = createGuardedFetch(
      {
        getByKey: (k) => registry.getByKey(k) as never,
        findEnabledByHost: (h) => registry.findEnabledByHost(h) as never,
        listEnabled: () => registry.listEnabled() as never,
      },
      makeFixtureTransport(),
    );
    const svc = new ResearchIngestionService({ registry, guardedFetch: guarded, store });
    const res = await svc.ingest(buildSanctionedResearchAdapters());
    const flagged = res.injectionFlags.find((f) => f.sourceKey === 'bls-industry');
    expect(flagged).toBeDefined();
    expect(flagged!.flags).toContain('ignore_instructions');
  });
});

// ---------------- 5. fixture ↔ seed parity ----------------

describe('research fixtures ↔ seed parity', () => {
  it('every seed key has a committed fixture and vice versa', () => {
    const seedKeys = new Set(M07_RESEARCH_SOURCE_SEED.map((e) => e.key));
    const fixtureKeys = new Set(Object.keys(RESEARCH_FIXTURES));
    expect(seedKeys).toEqual(fixtureKeys);
  });
});