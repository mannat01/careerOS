/**
 * Stream client tests — Task 4 headline: `approval_required` HALTS
 * consumption and hands off, and never auto-continues.
 *
 * We drive the SSE client with a mocked `fetch` that returns a hand-crafted
 * `ReadableStream` — no network, no real EventSource. The scenarios exercise:
 *
 *   1. A normal run (context → token* → done) yields the union events in order.
 *   2. `approval_required` HALTS: the iterator emits the event and returns
 *      cleanly WITHOUT consuming anything the mock queued after it.
 *   3. Parse errors are surfaced in-line as `TwinStreamParseError`, never
 *      swallowed.
 *   4. Server-emitted `error` events throw a typed `ApiError` and do NOT
 *      trigger a reconnect.
 *   5. External `AbortSignal` returns the iterator cleanly, no throw.
 *   6. Transport failures reconnect with backoff up to `maxReconnects`.
 *
 * The mock fetch factories are intentionally declared `async` so they line up
 * with the real `typeof fetch` signature; per-call bodies are synchronous
 * (the SSE frames are pre-built), which trips `require-await`. That rule is
 * disabled file-wide because the async signature is load-bearing.
 */
/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it } from 'vitest';
import { ApiError } from './errors';
import {
  openTwinStream,
  TwinStreamParseError,
  type TwinStreamEvent,
} from './stream';

// ---------- helpers ----------

type EventJson = Record<string, unknown>;
type RawFrame = { readonly rawFrame: string };
type SseFrameInput = EventJson | RawFrame;

function isRawFrame(f: SseFrameInput): f is RawFrame {
  return typeof (f as RawFrame).rawFrame === 'string';
}

/**
 * Build a `Response` whose body is a `ReadableStream` yielding the supplied
 * SSE frames. Each JSON frame is serialized as `data: {...}\n\n`; a
 * `{ rawFrame }` entry is emitted verbatim (used for parse-error scenarios).
 */
function sseResponse(frames: readonly SseFrameInput[]): Response {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = frames.map((f) =>
    isRawFrame(f)
      ? encoder.encode(f.rawFrame)
      : encoder.encode(`data: ${JSON.stringify(f)}\n\n`),
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function canonicalNamedSseResponse(events: readonly EventJson[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`event: ${String(event['type'])}\ndata: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(
  it: AsyncIterable<TwinStreamEvent | TwinStreamParseError>,
): Promise<Array<TwinStreamEvent | TwinStreamParseError>> {
  const out: Array<TwinStreamEvent | TwinStreamParseError> = [];
  for await (const ev of it) out.push(ev);
  return out;
}

// ---------- tests ----------

describe('openTwinStream — happy path', () => {
  it('yields context → token(s) → done in order and terminates', async () => {
    const fetchImpl = (async () =>
      sseResponse([
        { type: 'context', runId: 'r1', evidenceIds: ['opp-1'] },
        { type: 'token', runId: 'r1', text: 'Hel', index: 0 },
        { type: 'token', runId: 'r1', text: 'lo', index: 1 },
        { type: 'done', runId: 'r1', finalText: 'Hello' },
      ])) as unknown as typeof fetch;

    const iter = openTwinStream(
      { prompt: 'hi' },
      { maxReconnects: 0 },
      { baseUrl: 'https://x.test', fetchImpl },
    );
    const events = await collect(iter);

    expect(events.map((e) => (e as TwinStreamEvent).type)).toEqual([
      'context',
      'token',
      'token',
      'done',
    ]);
  });

  it('uses the canonical /rt/twin message body and consumes backend named SSE frames', async () => {
    let capturedUrl = '';
    let capturedBody = '';
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const body = init?.body;
      capturedBody = typeof body === 'string' ? body : '';
      return canonicalNamedSseResponse([
        { type: 'context', evidenceIds: ['experience:1'] },
        { type: 'tool_call', tool: 'strategic_reasoner' },
        { type: 'token', text: 'Grounded' },
        { type: 'done', outcome: 'grounded_answer' },
      ]);
    }) as typeof fetch;

    const events = await collect(openTwinStream({ prompt: 'Should I apply?' }, { maxReconnects: 0 }, { baseUrl: 'https://x.test', fetchImpl }));
    expect(capturedUrl).toBe('https://x.test/rt/twin');
    expect(JSON.parse(capturedBody)).toEqual({ message: 'Should I apply?' });
    expect(events.map((event) => (event as TwinStreamEvent).type)).toEqual(['context', 'tool_call', 'token', 'done']);
  });
});

describe('openTwinStream — approval_required HALTS (the headline)', () => {
  it('emits approval_required, then STOPS consuming, and never yields queued follow-up events', async () => {
    // Deliberately queue MORE events AFTER approval_required. If the iterator
    // auto-continued (bug!), we'd see the token and done events. It MUST NOT.
    const fetchImpl = (async () =>
      sseResponse([
        { type: 'context', runId: 'r1', evidenceIds: [] },
        { type: 'token', runId: 'r1', text: 'preparing...' },
        {
          type: 'approval_required',
          runId: 'r1',
          action: 'draft.send',
          payload: { to: 'ceo@example.com', subject: 'hi' },
          payloadHash: 'sha256:abc',
          reason: 'External comms — needs your approval.',
        },
        // Anything past here MUST NOT be observed by the consumer.
        { type: 'token', runId: 'r1', text: 'THIS SHOULD NEVER APPEAR' },
        { type: 'done', runId: 'r1' },
      ])) as unknown as typeof fetch;

    const iter = openTwinStream(
      { prompt: 'send an email to the CEO' },
      { maxReconnects: 0 },
      { baseUrl: 'https://x.test', fetchImpl },
    );
    const events = await collect(iter);

    expect(events.map((e) => (e as TwinStreamEvent).type)).toEqual([
      'context',
      'token',
      'approval_required',
    ]);
    const approval = events.at(-1) as Extract<TwinStreamEvent, { type: 'approval_required' }>;
    expect(approval.action).toBe('draft.send');
    expect(approval.payloadHash).toBe('sha256:abc');
    // Positive proof of the halt: no token past approval_required was yielded.
    for (const ev of events) {
      if ('text' in ev && typeof ev.text === 'string') {
        expect(ev.text).not.toContain('SHOULD NEVER APPEAR');
      }
    }
  });

  it('does not re-open the stream after approval_required (single fetch)', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return sseResponse([
        {
          type: 'approval_required',
          runId: 'r1',
          action: 'me.delete',
          payload: {},
          payloadHash: 'sha256:x',
        },
      ]);
    }) as unknown as typeof fetch;

    const iter = openTwinStream(
      { prompt: 'delete my account' },
      { maxReconnects: 5 }, // even with retries available, we must NOT retry.
      { baseUrl: 'https://x.test', fetchImpl },
    );
    await collect(iter);
    expect(calls).toBe(1);
  });
});

describe('openTwinStream — parse errors surface, never swallowed', () => {
  it('emits TwinStreamParseError for malformed JSON, continues past it', async () => {
    const fetchImpl = (async () =>
      sseResponse([
        { rawFrame: 'data: {not json\n\n' }, // malformed
        { type: 'token', runId: 'r1', text: 'ok' },
        { type: 'done', runId: 'r1' },
      ])) as unknown as typeof fetch;

    const iter = openTwinStream(
      { prompt: 'x' },
      { maxReconnects: 0 },
      { baseUrl: 'https://x.test', fetchImpl },
    );
    const events = await collect(iter);
    expect(events[0]).toBeInstanceOf(TwinStreamParseError);
    expect((events[1] as TwinStreamEvent).type).toBe('token');
    expect((events[2] as TwinStreamEvent).type).toBe('done');
  });

  it('emits TwinStreamParseError for JSON that does not match the schema', async () => {
    const fetchImpl = (async () =>
      sseResponse([
        // valid JSON but not a member of the discriminated union
        { type: 'not_a_real_event', runId: 'r1' },
        { type: 'done', runId: 'r1' },
      ])) as unknown as typeof fetch;

    const iter = openTwinStream(
      { prompt: 'x' },
      { maxReconnects: 0 },
      { baseUrl: 'https://x.test', fetchImpl },
    );
    const events = await collect(iter);
    expect(events[0]).toBeInstanceOf(TwinStreamParseError);
    expect((events[0] as TwinStreamParseError).zodIssues).toBeDefined();
    expect((events[1] as TwinStreamEvent).type).toBe('done');
  });
});

describe('openTwinStream — server error events throw ApiError, no reconnect', () => {
  it('yields the canonical error event, then throws an ApiError without retrying', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return sseResponse([
        {
          type: 'error',
          runId: 'r1',
          code: 'model_timeout',
          message: 'The model timed out.',
          traceId: 'trace-abc',
        },
      ]);
    }) as unknown as typeof fetch;

    const iter = openTwinStream(
      { prompt: 'x' },
      { maxReconnects: 5 },
      { baseUrl: 'https://x.test', fetchImpl },
    );

    let thrown: unknown;
    const yielded: TwinStreamEvent[] = [];
    try {
      for await (const event of iter) {
        if (!(event instanceof TwinStreamParseError)) yielded.push(event);
      }
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).message).toBe('The model timed out.');
    expect((thrown as ApiError).traceId).toBe('trace-abc');
    expect(yielded).toEqual([{
      type: 'error', runId: 'r1', code: 'model_timeout', message: 'The model timed out.', traceId: 'trace-abc',
    }]);
    expect(calls).toBe(1); // no reconnect on server-side run error
  });
});

describe('openTwinStream — abort returns cleanly', () => {
  it('closes on external AbortSignal without throwing', async () => {
    const controller = new AbortController();
    const fetchImpl = (async () => {
      // Never-resolving stream: emit nothing until aborted.
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          // Immediately abort after start.
          setTimeout(() => {
            controller.abort();
            ctrl.close();
          }, 5);
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;

    const iter = openTwinStream(
      { prompt: 'x' },
      { signal: controller.signal, maxReconnects: 0 },
      { baseUrl: 'https://x.test', fetchImpl },
    );
    // Should return cleanly (no throw). We consume with a plain for-await
    // and assert no exception escapes.
    const events = await collect(iter);
    // May be empty — the important thing is: no throw.
    expect(Array.isArray(events)).toBe(true);
  });
});

describe('openTwinStream — reconnect on transport failure', () => {
  it('retries up to maxReconnects on non-2xx responses, then throws typed ApiError', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      // Always return 503.
      return new Response('service unavailable', { status: 503 });
    }) as unknown as typeof fetch;

    const iter = openTwinStream(
      { prompt: 'x' },
      { maxReconnects: 2, baseBackoffMs: 1 },
      { baseUrl: 'https://x.test', fetchImpl },
    );

    let thrown: unknown;
    try {
      for await (const _ of iter) void _;
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe('internal');
    // 1 initial + 2 reconnects = 3 fetches.
    expect(calls).toBe(3);
  });

  it('recovers on reconnect: transient failure then success', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return new Response('boom', { status: 502 });
      return sseResponse([
        { type: 'context', runId: 'r1', evidenceIds: [] },
        { type: 'done', runId: 'r1' },
      ]);
    }) as unknown as typeof fetch;

    const iter = openTwinStream(
      { prompt: 'x' },
      { maxReconnects: 3, baseBackoffMs: 1 },
      { baseUrl: 'https://x.test', fetchImpl },
    );
    const events = await collect(iter);
    expect(events.map((e) => (e as TwinStreamEvent).type)).toEqual(['context', 'done']);
    expect(calls).toBe(2);
  });
});
