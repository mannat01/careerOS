import { describe, expect, it } from 'vitest';
import {
  createAuditClient,
  createLogger,
  InMemoryAuditSink,
  newTraceId,
  redact,
  type LogEntry,
} from '../src/index.js';

const FIXED = new Date('2026-07-08T08:00:00.000Z');

describe('structured logger (no PII)', () => {
  function capture(): { entries: LogEntry[]; sink: { write(e: LogEntry): void } } {
    const entries: LogEntry[] = [];
    return { entries, sink: { write: (e) => void entries.push(e) } };
  }

  it('emits structured JSON-safe entries with level/msg/time', () => {
    const { entries, sink } = capture();
    const log = createLogger({ sink, clock: () => FIXED });
    log.info('ingestion complete', { count: 3 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ level: 'info', msg: 'ingestion complete', count: 3, time: FIXED.toISOString() });
    expect(() => JSON.stringify(entries[0])).not.toThrow();
  });

  it('redacts sensitive keys (email, token, apiKey, authProviderId)', () => {
    const { entries, sink } = capture();
    const log = createLogger({ sink, clock: () => FIXED });
    log.info('user updated', {
      email: 'user@example.com',
      token: 'tok_abc',
      apiKey: 'sk-123',
      auth_provider_id: 'clerk_9',
      nested: { phone: '555-0100', ok: 'visible' },
    });
    const e = entries[0] as Record<string, unknown>;
    expect(e['email']).toBe('[REDACTED]');
    expect(e['token']).toBe('[REDACTED]');
    expect(e['apiKey']).toBe('[REDACTED]');
    expect(e['auth_provider_id']).toBe('[REDACTED]');
    expect((e['nested'] as Record<string, unknown>)['phone']).toBe('[REDACTED]');
    expect((e['nested'] as Record<string, unknown>)['ok']).toBe('visible');
  });

  it('scrubs email-shaped strings inside values and messages', () => {
    const { entries, sink } = capture();
    const log = createLogger({ sink, clock: () => FIXED });
    log.warn('contact user@example.com failed', { note: 'reply to jane.doe@corp.io soon' });
    const e = entries[0] as Record<string, unknown>;
    expect(e['msg']).not.toContain('user@example.com');
    expect(e['note']).not.toContain('jane.doe@corp.io');
  });

  it('child loggers inherit and redact bindings', () => {
    const { entries, sink } = capture();
    const log = createLogger({ sink, clock: () => FIXED }).child({ traceId: 't-1', email: 'x@y.io' });
    log.info('step');
    const e = entries[0] as Record<string, unknown>;
    expect(e['traceId']).toBe('t-1');
    expect(e['email']).toBe('[REDACTED]');
  });

  it('redact() is safe on primitives and arrays', () => {
    expect(redact('mail me: a@b.co')).toBe('mail me: [REDACTED]');
    expect(redact([{ email: 'a@b.co' }])).toEqual([{ email: '[REDACTED]' }]);
    expect(redact(42)).toBe(42);
  });
});

describe('audit client (immutable, injectable sink)', () => {
  it('writes complete records with id + timestamp to the sink', async () => {
    const sink = new InMemoryAuditSink();
    const audit = createAuditClient({ sink, clock: () => FIXED, idFactory: () => 'audit-1' });
    const rec = await audit.append({
      userId: 'u-1', actor: 'twin', action: 'capability_gate.denied',
      target: 'draft.send', reason: 'approval missing', traceId: 'trace-1',
    });
    expect(rec).toEqual({
      id: 'audit-1', userId: 'u-1', actor: 'twin', action: 'capability_gate.denied',
      target: 'draft.send', reason: 'approval missing', modelVersion: null,
      traceId: 'trace-1', at: FIXED.toISOString(),
    });
    expect(sink.records()).toHaveLength(1);
  });

  it('records are frozen (immutable)', async () => {
    const sink = new InMemoryAuditSink();
    const audit = createAuditClient({ sink, clock: () => FIXED });
    const rec = await audit.append({ userId: 'u-1', actor: 'user', action: 'a', reason: 'r' });
    expect(Object.isFrozen(rec)).toBe(true);
    expect(() => {
      (rec as { reason: string }).reason = 'tampered';
    }).toThrow();
  });

  it('the in-memory sink is append-only: exposed views cannot mutate the log', async () => {
    const sink = new InMemoryAuditSink();
    const audit = createAuditClient({ sink, clock: () => FIXED });
    await audit.append({ userId: 'u-1', actor: 'system', action: 'a', reason: 'r' });
    const view = sink.records() as unknown[];
    view.pop();
    expect(sink.records()).toHaveLength(1);
  });

  it('satisfies the capability-gate AuditWriter shape structurally', async () => {
    const sink = new InMemoryAuditSink();
    const audit = createAuditClient({ sink, clock: () => FIXED });
    // Shape used by @careeros/capability-gate enforce():
    await audit.append({ userId: 'u', actor: 'system', action: 'capability_gate.allowed', target: 'x', reason: 'green', traceId: null });
    expect(sink.records()[0]?.action).toBe('capability_gate.allowed');
  });
});

describe('trace ids', () => {
  it('generates 32-hex-char ids, unique across calls', () => {
    const a = newTraceId();
    const b = newTraceId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});
