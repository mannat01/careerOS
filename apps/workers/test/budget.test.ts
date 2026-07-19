/**
 * M07 Step 4 — RunBudget unit tests (ADR-003 per-user daily LLM cap).
 *
 * ADR-003 requires graceful degradation when a user exceeds the daily LLM
 * cap: the loop parks/skips the expensive step, it does NOT fail the run.
 * These tests pin:
 *   - construction rejects invalid caps
 *   - `canAfford` is a preflight (doesn't mutate state)
 *   - `charge` accumulates, ignores negative/NaN defensively
 *   - `isExhausted` fires at exactly the cap boundary
 *   - `capForTier` follows ADR-003 free vs pro
 */
import { describe, expect, it } from 'vitest';
import { RunBudget, capForTier, DAILY_LLM_CAP_USD } from '../src/scheduler/budget.js';

describe('RunBudget', () => {
  it('rejects negative or non-finite caps', () => {
    expect(() => new RunBudget(-1)).toThrow();
    expect(() => new RunBudget(Number.NaN)).toThrow();
    expect(() => new RunBudget(Number.POSITIVE_INFINITY)).toThrow();
  });
  it('starts empty', () => {
    const b = new RunBudget(0.5);
    expect(b.totalSpent()).toBe(0);
    expect(b.capUsd()).toBe(0.5);
    expect(b.isExhausted()).toBe(false);
  });
  it('canAfford is a preflight (does not mutate)', () => {
    const b = new RunBudget(0.5);
    expect(b.canAfford(0.4)).toBe(true);
    expect(b.canAfford(0.6)).toBe(false);
    expect(b.totalSpent()).toBe(0);
  });
  it('charges accumulate; cap includes the boundary (<=)', () => {
    const b = new RunBudget(0.5);
    b.charge(0.3);
    expect(b.totalSpent()).toBeCloseTo(0.3, 8);
    b.charge(0.2);
    expect(b.totalSpent()).toBeCloseTo(0.5, 8);
    expect(b.isExhausted()).toBe(true);
    expect(b.canAfford(0.0001)).toBe(false);
  });
  it('defensively ignores negative / NaN charges', () => {
    const b = new RunBudget(0.5);
    b.charge(-1);
    b.charge(Number.NaN);
    expect(b.totalSpent()).toBe(0);
  });
});

describe('capForTier (ADR-003)', () => {
  it('maps free → free cap', () => {
    expect(capForTier('free')).toBe(DAILY_LLM_CAP_USD.free);
  });
  it('maps pro → pro cap', () => {
    expect(capForTier('pro')).toBe(DAILY_LLM_CAP_USD.pro);
  });
  it('defaults unknown to free (fail-safe)', () => {
    expect(capForTier('enterprise')).toBe(DAILY_LLM_CAP_USD.free);
    expect(capForTier(undefined)).toBe(DAILY_LLM_CAP_USD.free);
  });
  it('pro cap is strictly greater than free', () => {
    expect(DAILY_LLM_CAP_USD.pro).toBeGreaterThan(DAILY_LLM_CAP_USD.free);
  });
});