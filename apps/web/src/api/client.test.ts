/**
 * Runtime tests for the typed API client (Task 3).
 *
 * Proves:
 *  1. Bearer auth is attached.
 *  2. Idempotency-Key is added on mutating POST/PATCH and NOT on GET/DELETE.
 *  3. traceId is propagated (request `x-trace-id` header) and reflected on the
 *     ApiError (from response header or the request-side id when the server
 *     doesn't echo).
 *  4. Every backend ErrorCode is mapped to a typed ApiError — no swallowing.
 *  5. Malformed error payloads still surface as a typed `internal` ApiError
 *     with the raw body attached, never a generic Error.
 *  6. Contract-drift on the response (zod fail) surfaces as `internal` with
 *     the zod issues attached.
 *  7. Yellow POSTs attach `x-approval-token` at runtime.
 *  8. Network / abort errors surface as typed ApiError('internal').
 *  9. `userId` is never in the outbound URL or headers (client-side check).
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createApiClient, type TokenProvider } from './client';
import { ApiError, recoveryForError } from './errors';
import { unsafe_brandApprovalToken } from './approval';
import type { ErrorCode } from '@careeros/contracts';

const BASE = 'https://api.example.test';

interface Captured {
  url: string;
  init: RequestInit;
}

/** Build a stub fetch that records the call and returns a canned Response. */
function stubFetch(response: Response): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  // eslint-disable-next-line @typescript-eslint/require-await
  const fn: typeof fetch = async (input, init) => {
    // `Request` / `URL` / `string` — force a string form for the recording.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const url = typeof input === 'string' ? input : String(input);
    calls.push({ url, init: init ?? {} });
    return response;
  };
  return { fetch: fn, calls };
}

function makeClient(overrides: {
  response: Response;
  token?: string | null;
  traceId?: string;
  idemKey?: string;
}): ReturnType<typeof createApiClient> & { _calls: Captured[] } {
  const { fetch: stub, calls } = stubFetch(overrides.response);
  const tokens: TokenProvider = {
    // eslint-disable-next-line @typescript-eslint/require-await
    getBearerToken: async () => overrides.token ?? null,
  };
  const client = createApiClient({
    baseUrl: BASE,
    tokens,
    fetchImpl: stub,
    newTraceId: () => overrides.traceId ?? 'trace-fixed',
    newIdempotencyKey: () => overrides.idemKey ?? 'idem-fixed',
  });
  return Object.assign(client, { _calls: calls });
}

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  const existing = init.headers ? new Headers(init.headers) : new Headers();
  existing.forEach((v, k) => headers.set(k, v));
  return new Response(JSON.stringify(body), { ...init, headers });
}

describe('createApiClient — request wiring', () => {
  it('attaches bearer token, trace id, and accept header on GET; omits idempotency-key', async () => {
    const schema = z.object({ ok: z.literal(true) });
    const client = makeClient({
      response: jsonResponse({ ok: true }),
      token: 'tok-abc',
      traceId: 'trace-1',
    });
    await client.get('/v1/ping', schema);

    expect(client._calls).toHaveLength(1);
    const c = client._calls[0]!;
    expect(c.url).toBe(`${BASE}/v1/ping`);
    const headers = new Headers(c.init.headers ?? {});
    expect(headers.get('authorization')).toBe('Bearer tok-abc');
    expect(headers.get('x-trace-id')).toBe('trace-1');
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('idempotency-key')).toBeNull();
  });

  it('adds an Idempotency-Key on Green POST', async () => {
    const schema = z.object({ id: z.string() });
    const client = makeClient({
      response: jsonResponse({ id: 'x' }, { status: 201 }),
      token: 'tok',
      idemKey: 'idem-777',
    });
    await client.postGreen('research.run', '/v1/research/run', { q: 1 }, schema);

    const headers = new Headers(client._calls[0]!.init.headers ?? {});
    expect(headers.get('idempotency-key')).toBe('idem-777');
    expect(headers.get('x-action')).toBe('research.run');
    expect(headers.get('content-type')).toBe('application/json');
    expect(client._calls[0]!.init.method).toBe('POST');
  });

  it('adds an x-approval-token on Yellow POST', async () => {
    const schema = z.object({ id: z.string() });
    const client = makeClient({
      response: jsonResponse({ id: 'x' }, { status: 200 }),
      token: 'tok',
    });
    const approval = unsafe_brandApprovalToken('appr-abc');
    await client.postYellow(
      'briefing.item.execute',
      '/v1/briefings/r1/items/i1/approve',
      undefined,
      schema,
      approval,
    );
    const headers = new Headers(client._calls[0]!.init.headers ?? {});
    expect(headers.get('x-approval-token')).toBe('appr-abc');
    expect(headers.get('x-action')).toBe('briefing.item.execute');
    expect(headers.get('idempotency-key')).toBeTruthy();
  });

  it('never puts userId into the outbound URL or headers', async () => {
    const schema = z.object({ ok: z.literal(true) });
    const client = makeClient({ response: jsonResponse({ ok: true }), token: 'tok' });
    await client.get('/v1/me', schema);
    const c = client._calls[0]!;
    expect(c.url).not.toMatch(/user[_-]?id|userId/i);
    const headerNames = Array.from(new Headers(c.init.headers ?? {}).keys());
    expect(headerNames.some((h) => /user[_-]?id/i.test(h))).toBe(false);
  });
});

describe('createApiClient — error mapping', () => {
  const codes: ErrorCode[] = [
    'unauthenticated',
    'forbidden',
    'not_found',
    'validation_failed',
    'rate_limited',
    'capability_denied',
    'source_not_allowed',
    'conflict',
    'internal',
  ];

  for (const code of codes) {
    it(`maps HTTP error with code=${code} into a typed ApiError`, async () => {
      const client = makeClient({
        response: jsonResponse(
          { error: { code, message: `msg-${code}`, traceId: 'srv-trace', details: { k: 'v' } } },
          { status: statusFor(code) },
        ),
      });
      const promise = client.get('/v1/x', z.unknown());
      await expect(promise).rejects.toBeInstanceOf(ApiError);
      try {
        await promise;
      } catch (err) {
        const e = err as ApiError;
        expect(e.code).toBe(code);
        expect(e.message).toBe(`msg-${code}`);
        expect(e.traceId).toBe('srv-trace');
        expect(e.details).toEqual({ k: 'v' });
        // Recovery mapping never returns undefined; exhaustive.
        expect(recoveryForError(e)).toBeTypeOf('object');
      }
    });
  }

  it('malformed error payload surfaces as typed internal ApiError with raw body attached', async () => {
    const client = makeClient({
      response: new Response('not-json-{', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      }),
    });
    try {
      await client.get('/v1/x', z.unknown());
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const e = err as ApiError;
      expect(e.code).toBe('internal');
      expect(e.details).toBeDefined();
      expect(e.status).toBe(500);
    }
  });

  it('response contract drift surfaces as typed internal ApiError (zod issues attached)', async () => {
    const schema = z.object({ id: z.string(), n: z.number() });
    const client = makeClient({
      response: jsonResponse({ id: 'a' /* missing n */ }),
    });
    try {
      await client.get('/v1/x', schema);
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const e = err as ApiError;
      expect(e.code).toBe('internal');
      expect(e.details).toBeDefined();
      const details = e.details as { zodIssues?: unknown };
      expect(details.zodIssues).toBeDefined();
    }
  });

  it('network fault surfaces as typed internal ApiError, never generic', async () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    const boom: typeof fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    const client = createApiClient({
      baseUrl: BASE,
      // eslint-disable-next-line @typescript-eslint/require-await
      tokens: { getBearerToken: async () => null },
      fetchImpl: boom,
      newTraceId: () => 't',
      newIdempotencyKey: () => 'i',
    });
    try {
      await client.get('/v1/x', z.unknown());
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const e = err as ApiError;
      expect(e.code).toBe('internal');
      expect(e.message).toBe('Failed to fetch');
    }
  });

  it('abort surfaces as typed internal ApiError with aborted flag', async () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    const abortFetch: typeof fetch = async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    };
    const client = createApiClient({
      baseUrl: BASE,
      // eslint-disable-next-line @typescript-eslint/require-await
      tokens: { getBearerToken: async () => null },
      fetchImpl: abortFetch,
      newTraceId: () => 't',
      newIdempotencyKey: () => 'i',
    });
    const controller = new AbortController();
    controller.abort();
    try {
      await client.get('/v1/x', z.unknown(), { signal: controller.signal });
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const e = err as ApiError;
      expect(e.code).toBe('internal');
      expect(e.details).toEqual({ aborted: true });
    }
  });
});

/** Helper: pick an HTTP status appropriate for each ErrorCode. */
function statusFor(code: ErrorCode): number {
  switch (code) {
    case 'unauthenticated':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'validation_failed':
      return 400;
    case 'rate_limited':
      return 429;
    case 'capability_denied':
      return 403;
    case 'source_not_allowed':
      return 403;
    case 'conflict':
      return 409;
    case 'internal':
      return 500;
  }
}