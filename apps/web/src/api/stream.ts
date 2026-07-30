/**
 * SSE client for `/rt/twin` — Task 4 (FM1).
 *
 * A typed async iterator over the Twin event union. Consumers `for await` the
 * stream; the iterator applies **backoff + reconnect** on transport errors,
 * respects an external `AbortSignal`, and **HALTS on `approval_required`** so
 * the UI can hand off to the ApprovalDialog (Trust Kit, Batch C) — the stream
 * NEVER auto-continues a Yellow-tier action. This mirrors the backend
 * capability-gate: even if a token exists, the client must obtain it through
 * the dialog and reopen a fresh stream after the user's decision.
 *
 * Parse errors are surfaced as typed `TwinStreamParseError` items in-line
 * (the iterator does NOT swallow them into a generic catch). Transport errors
 * are surfaced as `ApiError`s the caller can inspect and react to.
 *
 * References:
 *   - `docs/frontend-architecture.md` §4.3 (streaming), §5 (approval handoff)
 *   - `docs/frontend-milestone-01-workorder.md` Task 4
 */
import { z } from 'zod';
import { ApiError } from './errors.js';
import { loadWebEnv } from '../config/env.js';
import type { TokenProvider } from './client.js';

// Match the module-level `defaultTokenProvider` in client.ts (no bearer =>
// unauthenticated request). Deliberately duplicated so this file has no
// coupling to client.ts internals — features that need auth pass their own
// provider via `deps.tokens`.
const nullTokenProvider: TokenProvider = {
  // eslint-disable-next-line @typescript-eslint/require-await
  getBearerToken: async () => null,
};

// ---------- event union ----------
//
// The event schema is duplicated here as zod schemas because the backend
// realtime types have not yet been published to `@careeros/contracts`
// (M03/M04 backend milestones). When they are, this file will switch to
// `import { twinStreamEventSchema } from '@careeros/contracts'` and the
// local schemas will be deleted. Keeping the runtime shape encoded in zod
// means a server-side field addition FAILS LOUDLY (typed parse error)
// rather than being silently dropped.

/** `context` — the min-slice evidence the Twin will reason over. */
export const twinContextEventSchema = z.object({
  type: z.literal('context'),
  runId: z.string(),
  /** Provenance IDs (opportunity/finding/note) the Twin loaded. */
  evidenceIds: z.array(z.string()).default([]),
  /** Optional human-readable summary rendered above the stream. */
  summary: z.string().optional(),
});

/** `token` — one chunk of LLM output; append to the live transcript. */
export const twinTokenEventSchema = z.object({
  type: z.literal('token'),
  runId: z.string(),
  /** The token text; may be a single grapheme or a longer chunk. */
  text: z.string(),
  /** Monotonic index for reordering across reconnects (optional). */
  index: z.number().int().nonnegative().optional(),
});

/** `tool_call` — the Twin invoked a tool; render "used {tool}". */
export const twinToolCallEventSchema = z.object({
  type: z.literal('tool_call'),
  runId: z.string(),
  callId: z.string(),
  tool: z.string(),
  /** JSON-encoded arguments (opaque to the client). */
  argsJson: z.string(),
});

/** `tool_result` — pair with a prior `tool_call` by `callId`. */
export const twinToolResultEventSchema = z.object({
  type: z.literal('tool_result'),
  runId: z.string(),
  callId: z.string(),
  ok: z.boolean(),
  /** JSON-encoded result (opaque). */
  resultJson: z.string().optional(),
  /** Present when `ok=false`. */
  errorMessage: z.string().optional(),
});

/**
 * `approval_required` — the Twin wants to perform a Yellow action. **Consumers
 * MUST halt** (this iterator halts automatically) and route the user through
 * the ApprovalDialog. The dialog mints a single-use ApprovalToken which the
 * feature code then submits via the api client's `postYellow` — a fresh
 * stream is opened after the approval outcome, this one is CLOSED.
 */
export const twinApprovalRequiredEventSchema = z.object({
  type: z.literal('approval_required'),
  runId: z.string(),
  /**
   * The gate action name (must match `YellowAction` in `approval.ts` — but we
   * intentionally do NOT constrain it here: the server is the source of truth
   * and the ApprovalDialog cross-checks against the client's tier map. This
   * keeps a server-side addition parseable in old clients.)
   */
  action: z.string(),
  /**
   * Structured, human-legible payload the dialog renders VERBATIM. The user
   * is approving exactly this — no summarization or elision.
   */
  payload: z.unknown(),
  /**
   * Opaque payload hash the server computed; used later to mint an
   * ApprovalToken bound to this exact (user, action, payloadHash) triple.
   */
  payloadHash: z.string(),
  /** Optional prose explaining why the Twin proposed this action. */
  reason: z.string().optional(),
});

/** `done` — the Twin finished its turn; iterator returns after emitting. */
export const twinDoneEventSchema = z.object({
  type: z.literal('done'),
  runId: z.string(),
  /** Optional final assistant message for consumers that want a whole string. */
  finalText: z.string().optional(),
  /** Optional cost/latency telemetry surfaced in dev tools. */
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      elapsedMs: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

/** `error` — server-side failure inside the run; iterator throws ApiError. */
export const twinErrorEventSchema = z.object({
  type: z.literal('error'),
  runId: z.string().optional(),
  code: z.string(),
  message: z.string(),
  traceId: z.string().optional(),
});

export const twinStreamEventSchema = z.discriminatedUnion('type', [
  twinContextEventSchema,
  twinTokenEventSchema,
  twinToolCallEventSchema,
  twinToolResultEventSchema,
  twinApprovalRequiredEventSchema,
  twinDoneEventSchema,
  twinErrorEventSchema,
]);

export type TwinContextEvent = z.infer<typeof twinContextEventSchema>;
export type TwinTokenEvent = z.infer<typeof twinTokenEventSchema>;
export type TwinToolCallEvent = z.infer<typeof twinToolCallEventSchema>;
export type TwinToolResultEvent = z.infer<typeof twinToolResultEventSchema>;
export type TwinApprovalRequiredEvent = z.infer<typeof twinApprovalRequiredEventSchema>;
export type TwinDoneEvent = z.infer<typeof twinDoneEventSchema>;
export type TwinErrorEvent = z.infer<typeof twinErrorEventSchema>;
export type TwinStreamEvent = z.infer<typeof twinStreamEventSchema>;

// ---------- open params + options ----------

export interface OpenTwinStreamParams {
  /** The `/v1/rt/twin` route accepts a prompt + optional context handle. */
  prompt: string;
  /** Optional server-side session/context id to resume within. */
  sessionId?: string;
}

export interface OpenTwinStreamOptions {
  /** External abort signal — caller cancels; iterator returns cleanly. */
  signal?: AbortSignal;
  /**
   * Max reconnect attempts on TRANSPORT errors. Default: 3. A `done` or an
   * `approval_required` event is NOT a transport error and does not trigger
   * reconnect — the iterator terminates normally.
   */
  maxReconnects?: number;
  /**
   * Base delay for exponential backoff between reconnects, in ms.
   * Total wait per attempt: `baseBackoffMs * 2^attempt` (attempt is 0-based).
   * Default: 250.
   */
  baseBackoffMs?: number;
}

export interface OpenTwinStreamDeps {
  /** Base URL — defaults to `NEXT_PUBLIC_API_BASE_URL`. */
  baseUrl?: string;
  /** Bearer token provider — defaults to the module-level provider. */
  tokens?: TokenProvider;
  /** Injected fetch for tests. */
  fetchImpl?: typeof fetch;
}

// ---------- errors surfaced to the consumer ----------

/**
 * A single SSE frame failed to parse. Emitted IN-LINE by the iterator so
 * consumers can decide (e.g. log + continue). Never swallowed.
 */
export class TwinStreamParseError extends Error {
  readonly kind = 'parse' as const;
  readonly rawFrame: string;
  readonly zodIssues?: z.ZodIssue[];
  constructor(message: string, rawFrame: string, zodIssues?: z.ZodIssue[]) {
    super(message);
    this.name = 'TwinStreamParseError';
    this.rawFrame = rawFrame;
    this.zodIssues = zodIssues;
  }
}

// ---------- public entry ----------

/**
 * Open a `/rt/twin` stream. Returns an async iterator that yields
 * `TwinStreamEvent`s **or** `TwinStreamParseError` for individual bad frames.
 *
 * Termination rules (the trust-critical ones):
 *
 *   - `approval_required` → yield the event, then **return**. No reconnect.
 *     The feature is responsible for opening a fresh stream after the user
 *     decides in the ApprovalDialog. This is the *only* correct behavior
 *     under the capability-gate.
 *   - `done` → yield the event, then return.
 *   - `error` → throw an `ApiError` (mapped from the event's `code`).
 *   - Transport error (network drop, non-2xx) → backoff + reconnect up to
 *     `maxReconnects`; after that, throw an `ApiError('internal')`.
 *   - Abort → return cleanly, no throw.
 */
export function openTwinStream(
  params: OpenTwinStreamParams,
  options: OpenTwinStreamOptions = {},
  deps: OpenTwinStreamDeps = {},
): AsyncIterable<TwinStreamEvent | TwinStreamParseError> & { close: () => void } {
  const baseUrl = deps.baseUrl ?? loadWebEnv().NEXT_PUBLIC_API_BASE_URL;
  const tokens = deps.tokens ?? nullTokenProvider;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const maxReconnects = options.maxReconnects ?? 3;
  const baseBackoffMs = options.baseBackoffMs ?? 250;

  const internalController = new AbortController();
  const externalSignal = options.signal;
  // Compose external abort → internal controller.
  const onExternalAbort = (): void => internalController.abort();
  if (externalSignal) {
    if (externalSignal.aborted) internalController.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  async function* iterate(): AsyncGenerator<TwinStreamEvent | TwinStreamParseError> {
    let attempt = 0;
    let halted = false;
    try {
      while (!halted && !internalController.signal.aborted) {
        try {
          const bearer = await tokens.getBearerToken();
          const headers: Record<string, string> = {
            accept: 'text/event-stream',
            'content-type': 'application/json',
          };
          if (bearer !== null) headers['authorization'] = `Bearer ${bearer}`;

          const response = await fetchImpl(joinUrl(baseUrl, '/v1/rt/twin'), {
            method: 'POST',
            headers,
            body: JSON.stringify({
              prompt: params.prompt,
              sessionId: params.sessionId,
            }),
            signal: internalController.signal,
            credentials: 'include',
          });

          if (!response.ok) {
            throw new ApiError({
              code: 'internal',
              message: `Twin stream open failed: HTTP ${String(response.status)}`,
              status: response.status,
              details: { attempt },
            });
          }
          if (!response.body) {
            throw new ApiError({
              code: 'internal',
              message: 'Twin stream open returned no body.',
              status: response.status,
              details: { attempt },
            });
          }

          // Consume SSE frames. yield events; watch for `approval_required`
          // / `done` / `error`.
          for await (const frame of readSseFrames(response.body, internalController.signal)) {
            if (frame.event !== null && frame.event !== 'message') {
              // Named SSE events are not used by /rt/twin — every event's
              // discriminator is inside the `data` JSON. Ignore stray
              // event lines rather than throwing.
              continue;
            }
            if (frame.data.length === 0) continue;

            let parsedJson: unknown;
            try {
              parsedJson = JSON.parse(frame.data);
            } catch (cause) {
              // Surface the parse error in-band; do NOT swallow.
              yield new TwinStreamParseError(
                cause instanceof Error ? cause.message : 'SSE frame is not valid JSON',
                frame.data,
              );
              continue;
            }

            const parsed = twinStreamEventSchema.safeParse(parsedJson);
            if (!parsed.success) {
              yield new TwinStreamParseError(
                'SSE frame did not match Twin event schema',
                frame.data,
                parsed.error.issues,
              );
              continue;
            }

            const event = parsed.data;

            // approval_required: HALT. Yield event, then RETURN (no reconnect).
            if (event.type === 'approval_required') {
              yield event;
              halted = true;
              return;
            }
            if (event.type === 'done') {
              yield event;
              halted = true;
              return;
            }
            if (event.type === 'error') {
              // Convert server-emitted `error` events into a typed ApiError.
              // This is not a transport failure — the run itself failed —
              // so we do NOT reconnect.
              throw new ApiError({
                code: 'internal',
                message: event.message,
                details: { serverCode: event.code, runId: event.runId },
                traceId: event.traceId,
              });
            }

            // Normal token / context / tool_* — yield and continue.
            yield event;
            // Once we've started yielding real events, reset the reconnect
            // counter — the connection was fully healthy.
            attempt = 0;
          }

          // Stream closed by the server without a `done` or
          // `approval_required` — treat as a transport hiccup + reconnect.
          if (halted || internalController.signal.aborted) return;
          throw new ApiError({
            code: 'internal',
            message: 'Twin stream closed without a terminal event.',
            details: { attempt },
          });
        } catch (cause) {
          if (internalController.signal.aborted) return;

          // ApiError from `error` event → do NOT reconnect, rethrow.
          if (cause instanceof ApiError) {
            const isServerRunError =
              typeof cause.details === 'object' &&
              cause.details !== null &&
              'serverCode' in (cause.details as Record<string, unknown>);
            if (isServerRunError) throw cause;
          }

          if (attempt >= maxReconnects) {
            // Give up. Surface a typed error so the consumer can render it.
            const message =
              cause instanceof Error
                ? cause.message
                : 'Twin stream failed after retries.';
            throw new ApiError({
              code: 'internal',
              message,
              details: {
                cause: cause instanceof Error ? cause.name : String(cause),
                attempts: attempt + 1,
              },
            });
          }

          const wait = baseBackoffMs * Math.pow(2, attempt);
          attempt += 1;
          await sleep(wait, internalController.signal);
          // loop → reopen
        }
      }
    } finally {
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  const iterable: AsyncIterable<TwinStreamEvent | TwinStreamParseError> & {
    close: () => void;
  } = {
    [Symbol.asyncIterator]() {
      return iterate();
    },
    close(): void {
      internalController.abort();
    },
  };
  return iterable;
}

// ---------- helpers ----------

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

interface SseFrame {
  event: string | null;
  data: string;
  id: string | null;
}

/**
 * Parse an SSE byte stream into frames. This is a minimal RFC-6202-shaped
 * reader — enough for `/rt/twin`. It supports:
 *
 *   - Frames separated by a blank line (`\n\n` or `\r\n\r\n`).
 *   - Fields: `event:`, `data:` (multi-line accumulates), `id:`.
 *   - Comment lines (starting with `:`) are ignored.
 *
 * On abort, the generator returns cleanly.
 */
async function* readSseFrames(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) {
        // Flush any trailing partial frame (unlikely with SSE, but safe).
        if (buffer.length > 0) {
          const frame = parseSseFrame(buffer);
          if (frame !== null) yield frame;
          buffer = '';
        }
        return;
      }
      buffer += decoder.decode(value, { stream: true });

      // Extract complete frames delimited by a blank line.
      // Normalize CRLF → LF for splitting.
      const normalized = buffer.replace(/\r\n/g, '\n');
      const parts = normalized.split('\n\n');
      // The last element is a (possibly empty) partial frame → keep in buffer.
      buffer = parts.pop() ?? '';
      for (const raw of parts) {
        const frame = parseSseFrame(raw);
        if (frame !== null) yield frame;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // reader may already be released on abort — ignore.
    }
  }
}

function parseSseFrame(raw: string): SseFrame | null {
  let event: string | null = null;
  const dataLines: string[] = [];
  let id: string | null = null;
  let anyField = false;
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    if (line.startsWith(':')) continue; // comment
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    // Per SSE spec, a single leading space after the colon is stripped.
    const rawValue = colon === -1 ? '' : line.slice(colon + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    if (field === 'event') {
      event = value;
      anyField = true;
    } else if (field === 'data') {
      dataLines.push(value);
      anyField = true;
    } else if (field === 'id') {
      id = value;
      anyField = true;
    }
    // Unknown fields are ignored per spec.
  }
  if (!anyField) return null;
  return { event, data: dataLines.join('\n'), id };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}