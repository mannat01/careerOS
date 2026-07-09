import { SourceNotAllowedError, type SourceRegistry } from './registry.js';

/**
 * The guarded fetch layer. EVERY outbound connector request goes through here;
 * the allow-list check happens BEFORE the transport is ever invoked, so a
 * non-allow-listed host can never be contacted (milestone-01.md acceptance).
 */

export interface HttpResponse {
  status: number;
  json(): Promise<unknown>;
}

export type HttpTransport = (url: URL) => Promise<HttpResponse>;

export type GuardedFetch = (rawUrl: string) => Promise<HttpResponse>;

export function createGuardedFetch(registry: SourceRegistry, transport: HttpTransport): GuardedFetch {
  return async function guardedFetch(rawUrl: string): Promise<HttpResponse> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new SourceNotAllowedError(rawUrl, 'unparseable URL');
    }

    if (url.protocol !== 'https:') {
      throw new SourceNotAllowedError(url.hostname, `insecure protocol ${url.protocol}`);
    }
    if (url.username !== '' || url.password !== '') {
      throw new SourceNotAllowedError(url.hostname, 'credentials in URL are not allowed');
    }

    const entry = registry.findEnabledByHost(url.hostname);
    if (entry === null) {
      throw new SourceNotAllowedError(url.hostname, 'host is not on the SourceRegistry allow-list');
    }

    return transport(url);
  };
}

// STUB(M01): live HTTP transport for the ingestion worker (global fetch + timeout +
// SourceRegistry.rate_policy enforcement via Redis). Tests inject a fake transport;
// this sandbox has no reliable outbound network.
export const liveHttpTransport: HttpTransport = async (url: URL): Promise<HttpResponse> => {
  const res = await fetch(url, { redirect: 'error' }); // no cross-host redirects
  return { status: res.status, json: () => res.json() as Promise<unknown> };
};
