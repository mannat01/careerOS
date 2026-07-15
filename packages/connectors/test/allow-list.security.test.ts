/**
 * ⚑ REQUIRED SECURITY TEST — milestone-01.md / workorder task 6:
 * a fetch to a host NOT in the SourceRegistry allow-list is rejected with
 * `source_not_allowed`, and the transport is NEVER invoked.
 */
import { describe, expect, it } from 'vitest';
import {
  createGuardedFetch,
  InMemorySourceRegistry,
  M01_SOURCE_REGISTRY_SEED,
  M04_SOURCE_REGISTRY_SEED,
  SourceNotAllowedError,
  type HttpTransport,
} from '../src/index.js';


function makeFetch(entries = [...M01_SOURCE_REGISTRY_SEED]): {
  guardedFetch: ReturnType<typeof createGuardedFetch>;
  calls: URL[];
} {
  const calls: URL[] = [];
  const transport: HttpTransport = (url) => {
    calls.push(url);
    return Promise.resolve({ status: 200, json: () => Promise.resolve({ jobs: [] }) });
  };
  return { guardedFetch: createGuardedFetch(new InMemorySourceRegistry(entries), transport), calls };
}

describe('connector allow-list (source_not_allowed)', () => {
  it('BLOCKS a non-allow-listed host and never touches the network', async () => {
    const { guardedFetch, calls } = makeFetch();
    await expect(guardedFetch('https://evil-jobs.example.com/v1/postings')).rejects.toMatchObject({
      name: 'SourceNotAllowedError',
      code: 'source_not_allowed',
      host: 'evil-jobs.example.com',
    });
    expect(calls).toHaveLength(0);
  });

  it('BLOCKS lookalike/suffix-spoofed hosts (exact-match, no substring tricks)', async () => {
    const { guardedFetch, calls } = makeFetch();
    for (const url of [
      'https://boards-api.greenhouse.io.attacker.com/v1/boards/x/jobs',
      'https://evilboards-api.greenhouse.io/v1/boards/x/jobs',
      'https://greenhouse.io/v1/boards/x/jobs',
    ]) {
      await expect(guardedFetch(url)).rejects.toBeInstanceOf(SourceNotAllowedError);
    }
    expect(calls).toHaveLength(0);
  });

  it('BLOCKS an allow-listed host whose source is disabled in the registry', async () => {
    const seed = M01_SOURCE_REGISTRY_SEED[0];
    if (seed === undefined) throw new Error('seed missing');
    const { guardedFetch, calls } = makeFetch([{ ...seed, enabled: false }]);
    await expect(
      guardedFetch('https://boards-api.greenhouse.io/v1/boards/acmecorp/jobs'),
    ).rejects.toBeInstanceOf(SourceNotAllowedError);
    expect(calls).toHaveLength(0);
  });

  it('BLOCKS non-https and credentialed URLs even for allow-listed hosts', async () => {
    const { guardedFetch, calls } = makeFetch();
    await expect(guardedFetch('http://boards-api.greenhouse.io/v1/boards/x/jobs')).rejects.toBeInstanceOf(SourceNotAllowedError);
    await expect(guardedFetch('https://user:pw@boards-api.greenhouse.io/v1/boards/x/jobs')).rejects.toBeInstanceOf(SourceNotAllowedError);
    await expect(guardedFetch('not a url')).rejects.toBeInstanceOf(SourceNotAllowedError);
    expect(calls).toHaveLength(0);
  });

  it('ALLOWS the one sanctioned M01 host and calls the transport exactly once', async () => {
    const { guardedFetch, calls } = makeFetch();
    const res = await guardedFetch('https://boards-api.greenhouse.io/v1/boards/acmecorp/jobs?content=true');
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.hostname).toBe('boards-api.greenhouse.io');
  });

  it('M01 seed contains exactly one enabled source: greenhouse (ADR-002)', () => {
    const registry = new InMemorySourceRegistry([...M01_SOURCE_REGISTRY_SEED]);
    const enabled = registry.listEnabled();
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.key).toBe('greenhouse');
  });
});

/**
 * ⚑ M04 allow-list — ADR-002 opens the door to Lever + USAJobs alongside
 * Greenhouse. Everything OUTSIDE those three keys must still be blocked at the
 * guarded-fetch layer with `source_not_allowed`.
 */
describe('connector allow-list — M04 launch set (greenhouse + lever + usajobs)', () => {
  function makeM04Fetch(): { guardedFetch: ReturnType<typeof createGuardedFetch>; calls: URL[] } {
    const calls: URL[] = [];
    const transport: HttpTransport = (url) => {
      calls.push(url);
      return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
    };
    return {
      guardedFetch: createGuardedFetch(new InMemorySourceRegistry([...M04_SOURCE_REGISTRY_SEED]), transport),
      calls,
    };
  }

  it('M04 seed contains exactly three enabled sources: greenhouse, lever, usajobs', () => {
    const registry = new InMemorySourceRegistry([...M04_SOURCE_REGISTRY_SEED]);
    const enabled = registry.listEnabled();
    expect(enabled.map((s) => s.key).sort()).toEqual(['greenhouse', 'lever', 'usajobs']);
    // Every enabled source must ALSO have a rate policy (milestone-04
    // §Deliverables: "each with rate policy").
    for (const s of enabled) expect(s.ratePolicy).toBeTruthy();
  });

  it('ALLOWS the three sanctioned M04 hosts (exact-match)', async () => {
    const { guardedFetch, calls } = makeM04Fetch();
    await guardedFetch('https://boards-api.greenhouse.io/v1/boards/acmecorp/jobs');
    await guardedFetch('https://api.lever.co/v0/postings/acmecorp?mode=json');
    await guardedFetch('https://data.usajobs.gov/api/search?Keyword=engineer');
    expect(calls.map((u) => u.hostname).sort()).toEqual([
      'api.lever.co',
      'boards-api.greenhouse.io',
      'data.usajobs.gov',
    ]);
  });

  it('BLOCKS every non-allow-listed source even when the M04 set is open', async () => {
    const { guardedFetch, calls } = makeM04Fetch();
    for (const url of [
      // A ToS-protected job board — not sanctioned by ADR-002.
      'https://www.linkedin.com/jobs/api/search',
      // A paid aggregator we haven't licensed — not sanctioned.
      'https://api.paidaggregator.example/v1/jobs',
      // Suffix-spoof of a sanctioned host.
      'https://api.lever.co.attacker.com/v0/postings/x',
      'https://data.usajobs.gov.attacker.com/api/search',
      // Prefix trick — Lever's real host is `api.lever.co`, not `api-lever.co`.
      'https://api-lever.co/v0/postings/x',
    ]) {
      await expect(guardedFetch(url)).rejects.toBeInstanceOf(SourceNotAllowedError);
    }
    expect(calls).toHaveLength(0);
  });

  it('BLOCKS an M04 host whose registry row is disabled at runtime', async () => {
    const registry = new InMemorySourceRegistry(
      M04_SOURCE_REGISTRY_SEED.map((s) => (s.key === 'lever' ? { ...s, enabled: false } : { ...s })),
    );
    const calls: URL[] = [];
    const guardedFetch = createGuardedFetch(registry, (url) => {
      calls.push(url);
      return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
    });
    // Greenhouse + USAJobs still work; Lever now blocked.
    await guardedFetch('https://boards-api.greenhouse.io/v1/boards/x/jobs');
    await guardedFetch('https://data.usajobs.gov/api/search');
    await expect(guardedFetch('https://api.lever.co/v0/postings/x?mode=json')).rejects.toBeInstanceOf(
      SourceNotAllowedError,
    );
    expect(calls.map((u) => u.hostname).sort()).toEqual(['boards-api.greenhouse.io', 'data.usajobs.gov']);
  });
});

