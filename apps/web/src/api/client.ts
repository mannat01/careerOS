/**
 * Typed API client for the CareerOS web app — the ONLY module allowed to call
 * `fetch` in apps/web (`docs/frontend-architecture.md §2, §4`). All routes and
 * every domain module compose the primitives exported here.
 *
 * Responsibilities (see `docs/frontend-milestone-01-workorder.md` task 3):
 *   - Attach the bearer token from the active auth provider (dev-JWT / Clerk).
 *   - Attach an `Idempotency-Key` on every mutating POST (required for Yellow).
 *   - Propagate + record `traceId` so a UI action correlates to the backend
 *     audit entry.
 *   - Parse responses through zod schemas from `@careeros/contracts` so the
 *     boundary fails loudly on drift instead of silently in front of a user.
 *   - Map EVERY backend error code (unauthenticated / forbidden / not_found /
 *     validation_failed / rate_limited / capability_denied / source_not_allowed
 *     / conflict / internal) into a typed `ApiError`. No error is ever
 *     swallowed into a generic catch.
 *   - Enforce approval at the type level: `postYellow` requires an
 *     `ApprovalToken` argument; a Yellow POST without a token does not
 *     typecheck. Red actions have NO client function at all.
 *   - `userId` is NEVER a parameter — the backend derives it from the verified
 *     token.
 */
import type { z } from 'zod';
import { loadWebEnv } from '../config/env.js';
import { ApiError, parseApiErrorPayload } from './errors.js';
import type { ApprovalToken, YellowAction, GreenAction } from './approval.js';

// ---------- token provider abstraction ----------

/**
 * Auth-provider-agnostic token source. In prod this is backed by Clerk; in
 * local/CI/e2e it is the dev-JWT provider. The abstraction lives here so the
 * client is provider-neutral (mirrors the backend's `AUTH_PROVIDER=dev|clerk`).
 */
export interface TokenProvider {
  /**
   * Return a bearer token or `null` when the caller is not signed in. `null`
   * is a valid state for public reads; the server will 401 for protected
   * endpoints and the client renders the sign-in recovery path.
   */
  getBearerToken(): Promise<string | null>;
}

/**
 * Default provider used by the app boot — read from a global set by the auth
 * layer (`src/auth/*`, Batch D). Kept intentionally tiny so tests can inject a
 * stub via `createApiClient({ tokens })` without touching global state.
 */
let defaultTokenProvider: TokenProvider = {
  // eslint-disable-next-line @typescript-eslint/require-await
  getBearerToken: async () => null,
};
export function setDefaultTokenProvider(provider: TokenProvider): void {
  defaultTokenProvider = provider;
}

// ---------- trace propagation ----------

/**
 * Minimal W3C-traceparent-shaped id generator. When OpenTelemetry web is
 * wired (post-FM1), the OTel SDK will replace this with the current span's
 * traceId; until then we mint a client-side id so the server has something to
 * correlate + log.
 */
function newTraceId(): string {
  // 16 random bytes → 32 hex chars → matches the W3C trace-id width.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    // Non-browser fallback (tests) — Math.random is fine for a correlation id.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** RFC-4122 v4 (best-effort) for Idempotency-Key values. */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: 16 random bytes into a UUID-shaped string.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const b0 = bytes[0] ?? 0;
  const b1 = bytes[1] ?? 0;
  const b2 = bytes[2] ?? 0;
  const b3 = bytes[3] ?? 0;
  const b4 = bytes[4] ?? 0;
  const b5 = bytes[5] ?? 0;
  const b6Raw = bytes[6] ?? 0;
  const b7 = bytes[7] ?? 0;
  const b8Raw = bytes[8] ?? 0;
  const b9 = bytes[9] ?? 0;
  const b10 = bytes[10] ?? 0;
  const b11 = bytes[11] ?? 0;
  const b12 = bytes[12] ?? 0;
  const b13 = bytes[13] ?? 0;
  const b14 = bytes[14] ?? 0;
  const b15 = bytes[15] ?? 0;
  const b6 = (b6Raw & 0x0f) | 0x40;
  const b8 = (b8Raw & 0x3f) | 0x80;
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  return (
    `${hex(b0)}${hex(b1)}${hex(b2)}${hex(b3)}-` +
    `${hex(b4)}${hex(b5)}-` +
    `${hex(b6)}${hex(b7)}-` +
    `${hex(b8)}${hex(b9)}-` +
    `${hex(b10)}${hex(b11)}${hex(b12)}${hex(b13)}${hex(b14)}${hex(b15)}`
  );
}

// ---------- request/response types ----------

export interface ApiClientOptions {
  /** Base URL for the API. Defaults to `NEXT_PUBLIC_API_BASE_URL`. */
  baseUrl?: string;
  /** Token provider. Defaults to the module-level default set at boot. */
  tokens?: TokenProvider;
  /** Injectable `fetch` for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable traceId generator for deterministic tests. */
  newTraceId?: () => string;
  /** Injectable Idempotency-Key generator for deterministic tests. */
  newIdempotencyKey?: () => string;
}

export interface RequestOptions {
  /** AbortSignal — plumbed through so callers can cancel long queries. */
  signal?: AbortSignal;
  /** Additional query params. Values are stringified; arrays repeat the key. */
  query?: Record<string, string | number | boolean | undefined | ReadonlyArray<string>>;
  /**
   * Override the auto-generated Idempotency-Key. Only meaningful for POST/
   * PATCH/PUT; ignored for GET/DELETE. Reusing a key produces the same
   * server-side outcome (backend enforces).
   */
  idempotencyKey?: string;
}

/** The typed API client — one instance per app. */
export interface ApiClient {
  /** Read (GET). Response parsed with the given zod schema. */
  get<T>(path: string, responseSchema: z.ZodType<T>, opts?: RequestOptions): Promise<T>;
  /** Green mutation (POST). No approval token; carries Idempotency-Key. */
  postGreen<T>(
    action: GreenAction | null,
    path: string,
    body: unknown,
    responseSchema: z.ZodType<T>,
    opts?: RequestOptions,
  ): Promise<T>;
  /**
   * Yellow mutation (POST). Requires an `ApprovalToken`; a call without one is
   * a compile error. Attaches `X-Approval-Token` + Idempotency-Key.
   */
  postYellow<T>(
    action: YellowAction,
    path: string,
    body: unknown,
    responseSchema: z.ZodType<T>,
    approval: ApprovalToken,
    opts?: RequestOptions,
  ): Promise<T>;
  /** PATCH — treated like a Green mutation (no approval-token flow). */
  patch<T>(
    path: string,
    body: unknown,
    responseSchema: z.ZodType<T>,
    opts?: RequestOptions,
  ): Promise<T>;
  /** DELETE — Green by default; a Yellow delete must use `postYellow` semantics. */
  del<T>(path: string, responseSchema: z.ZodType<T>, opts?: RequestOptions): Promise<T>;
}

// ---------- factory ----------

/**
 * Build an ApiClient. Prefer the module-level `apiClient` for app code; use
 * this factory to inject test doubles (fetch, tokens, id generators).
 */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? loadWebEnv().NEXT_PUBLIC_API_BASE_URL;
  const tokens = options.tokens ?? defaultTokenProvider;
  const fetchImpl = options.fetchImpl ?? fetch;
  const mkTraceId = options.newTraceId ?? newTraceId;
  const mkIdemKey = options.newIdempotencyKey ?? newIdempotencyKey;

  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
    responseSchema: z.ZodType<T>,
    extraHeaders: Record<string, string>,
    opts?: RequestOptions,
  ): Promise<T> {
    const url = buildUrl(baseUrl, path, opts?.query);
    const traceId = mkTraceId();

    // Bearer token: attach when the provider yields one. Never mutate the URL
    // with `userId` — server derives identity from the verified token.
    const bearer = await tokens.getBearerToken();

    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-trace-id': traceId,
      ...extraHeaders,
    };
    if (bearer !== null) headers['authorization'] = `Bearer ${bearer}`;
    if (body !== undefined && body !== null) headers['content-type'] = 'application/json';

    // Idempotency-Key: mandatory on mutating POSTs (Yellow requires it; Green
    // sends it too so retries are safe). Not on GET/DELETE.
    if (method === 'POST' || method === 'PATCH') {
      headers['idempotency-key'] = opts?.idempotencyKey ?? mkIdemKey();
    }

    let response: Response;
    try {
      const init: RequestInit = {
        method,
        headers,
        credentials: 'include',
      };
      if (body !== undefined && body !== null) {
        init.body = JSON.stringify(body);
      }
      if (opts?.signal) {
        init.signal = opts.signal;
      }
      response = await fetchImpl(url, init);
    } catch (cause) {
      // Network / abort / DNS — surface as typed ApiError('internal'), never
      // let a generic Error escape to the UI.
      if (isAbortError(cause)) {
        throw new ApiError({
          code: 'internal',
          message: 'Request aborted.',
          details: { aborted: true },
          traceId,
        });
      }
      throw new ApiError({
        code: 'internal',
        message: cause instanceof Error ? cause.message : 'Network request failed.',
        details: { cause: safeCause(cause) },
        traceId,
      });
    }

    const responseTraceId = response.headers.get('x-trace-id') ?? traceId;

    // Non-2xx: parse the server's ApiError shape (falls back to typed
    // `internal` if malformed). Nothing is thrown untyped from here.
    if (!response.ok) {
      const rawBody = await safeReadJson(response);
      throw parseApiErrorPayload(rawBody, {
        status: response.status,
        traceId: responseTraceId,
      });
    }

    // 204 No Content — schema must permit undefined/void.
    if (response.status === 204) {
      const parsed = responseSchema.safeParse(undefined);
      if (!parsed.success) {
        throw new ApiError({
          code: 'internal',
          message: 'Server returned 204 but a response body was expected.',
          details: { zodIssues: parsed.error.issues },
          traceId: responseTraceId,
          status: 204,
        });
      }
      return parsed.data;
    }

    const rawBody = await safeReadJson(response);
    const parsed = responseSchema.safeParse(rawBody);
    if (!parsed.success) {
      // Contract drift — fail loudly per architecture §4. Never coerce.
      throw new ApiError({
        code: 'internal',
        message: 'Response failed contract validation (client/server drift).',
        details: { zodIssues: parsed.error.issues, rawBody },
        traceId: responseTraceId,
        status: response.status,
      });
    }
    return parsed.data;
  }

  return {
    get: (path, schema, opts) => request('GET', path, undefined, schema, {}, opts),
    postGreen: (action, path, body, schema, opts) =>
      request(
        'POST',
        path,
        body,
        schema,
        // Include the action name in a header for the server-side audit trace
        // when known; `null` means the endpoint is unclassified (e.g. auth).
        action !== null ? { 'x-action': action } : {},
        opts,
      ),
    postYellow: (action, path, body, schema, approval, opts) =>
      request(
        'POST',
        path,
        body,
        schema,
        {
          'x-action': action,
          // Server verifies token against (user, action, payloadHash); a stale
          // or replayed token is rejected server-side.
          'x-approval-token': approval,
        },
        opts,
      ),
    patch: (path, body, schema, opts) => request('PATCH', path, body, schema, {}, opts),
    del: (path, schema, opts) => request('DELETE', path, undefined, schema, {}, opts),
  };
}

// ---------- helpers ----------

function buildUrl(
  baseUrl: string,
  path: string,
  query?: RequestOptions['query'],
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${normalizedBase}${normalizedPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, String(v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function safeReadJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // Return the raw text under a well-known key so parseApiErrorPayload can
    // still produce a typed error rather than throwing an untyped SyntaxError.
    return { rawText: text };
  }
}

function isAbortError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('name' in err)) return false;
  return err.name === 'AbortError';
}

function safeCause(err: unknown): unknown {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { value: String(err) };
}

// ---------- module-level singleton (lazy) ----------

let cached: ApiClient | undefined;
/** The app-wide ApiClient. First call reads env; subsequent calls reuse it. */
export function apiClient(): ApiClient {
  if (!cached) cached = createApiClient();
  return cached;
}

/** Test-only reset for the memoized client. */
export function _resetApiClientForTests(): void {
  cached = undefined;
}