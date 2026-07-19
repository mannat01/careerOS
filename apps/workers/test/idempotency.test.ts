/**
 * M07 Step 4 — Idempotency-store unit tests.
 *
 * The store's contract (SETNX semantics): first `claim` wins; every duplicate
 * returns false. These tests pin that + the composite key shape so a duplicate
 * trigger anywhere in the loop cannot silently produce two briefings.
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryIdempotencyStore,
  briefingIdempotencyKey,
} from '../src/scheduler/idempotency.js';

describe('briefingIdempotencyKey', () => {
  it('namespaces by userId + runDayKey', () => {
    expect(briefingIdempotencyKey('u1', '2026-07-19')).toBe('briefing:u1:2026-07-19');
  });
  it('never collides across users on the same day', () => {
    const a = briefingIdempotencyKey('u1', '2026-07-19');
    const b = briefingIdempotencyKey('u2', '2026-07-19');
    expect(a).not.toBe(b);
  });
});

describe('InMemoryIdempotencyStore', () => {
  it('first claim wins; duplicates return false', async () => {
    const s = new InMemoryIdempotencyStore();
    const k = 'briefing:u1:2026-07-19';
    expect(await s.claim(k, 'br-1')).toBe(true);
    expect(await s.claim(k, 'br-2')).toBe(false);
    // The first writer's id remains associated.
    expect(await s.get(k)).toBe('br-1');
  });
  it('different keys are independent', async () => {
    const s = new InMemoryIdempotencyStore();
    expect(await s.claim('briefing:u1:2026-07-19', 'a')).toBe(true);
    expect(await s.claim('briefing:u1:2026-07-20', 'b')).toBe(true);
    expect(await s.get('briefing:u1:2026-07-19')).toBe('a');
    expect(await s.get('briefing:u1:2026-07-20')).toBe('b');
  });
  it('get returns null for unclaimed keys', async () => {
    const s = new InMemoryIdempotencyStore();
    expect(await s.get('missing')).toBeNull();
  });
});