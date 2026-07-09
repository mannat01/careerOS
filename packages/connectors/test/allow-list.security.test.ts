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
