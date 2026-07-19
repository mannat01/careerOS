/**
 * M07 Step 4 — Per-user daily LLM budget cap (ADR-003 tiers).
 *
 * Overnight loops meter LLM cost onto the BriefingRun (§8 sequence step costs).
 * Per ADR-003, exceeding the per-user daily cap must degrade GRACEFULLY —
 * park/skip the expensive step with a flag rather than failing the entire run
 * (blank screens are what we're preventing).
 *
 * This module is a pure, deterministic budget accountant. The scheduler holds
 * one `RunBudget` instance per (user, day) and asks it — before every LLM step
 * — whether the step can proceed with its estimated cost. If not, the step is
 * SKIPPED with `budget_exceeded` reason (the loop marks the step `skipped`,
 * not `failed`, so the run is at worst PARTIAL, never blank).
 *
 * The caller supplies the daily cap; the concrete tier→cap mapping (free /
 * pro) lives in the app boundary via `capForTier` below.
 */

/** ADR-003 tiers. Mirrors the SubscriptionTier enum in @careeros/db. */
export type SubscriptionTier = 'free' | 'pro';

/**
 * Per-tier daily LLM cap in USD. Numbers are launch defaults consistent with
 * ADR-003 wording ("limited daily budget" for free; "higher, again-metered"
 * for pro). They are ENFORCED CENTRALLY here so nowhere else in the loop can
 * silently over-spend.
 */
export const DAILY_LLM_CAP_USD: Record<SubscriptionTier, number> = {
  free: 0.5,
  pro: 5.0,
};

/**
 * Lookup helper — never throws, defaults to `free` on unknown tier. Accepts
 * a plain `string | undefined` because tier values often arrive from DB /
 * env / user-settings without a narrowed type; callers can pass anything.
 */
export function capForTier(tier: string | undefined): number {
  if (tier === 'pro') return DAILY_LLM_CAP_USD.pro;
  return DAILY_LLM_CAP_USD.free;
}

/**
 * The scheduler's per-run budget accountant. Immutable-in-spirit: `charge`
 * mutates only the running total; `check` is a pure query. Both are called on
 * every LLM step in the overnight loop.
 */
export class RunBudget {
  private readonly cap: number;
  private spent = 0;

  constructor(dailyCapUsd: number) {
    if (!Number.isFinite(dailyCapUsd) || dailyCapUsd < 0) {
      throw new Error(`RunBudget: cap must be a non-negative finite number, got ${dailyCapUsd}`);
    }
    this.cap = dailyCapUsd;
  }

  /** Current per-run running total in USD. */
  totalSpent(): number {
    return this.spent;
  }

  /** Configured cap in USD. */
  capUsd(): number {
    return this.cap;
  }

  /**
   * Would a step costing `estimateUsd` still fit under the cap? Called BEFORE
   * the LLM call to decide whether to run or park the step.
   */
  canAfford(estimateUsd: number): boolean {
    if (!Number.isFinite(estimateUsd) || estimateUsd < 0) return false;
    return this.spent + estimateUsd <= this.cap;
  }

  /**
   * Record the actual cost of a completed step. Rejects negative/NaN inputs
   * defensively; this is metering, not accounting for refunds.
   */
  charge(actualUsd: number): void {
    if (!Number.isFinite(actualUsd) || actualUsd < 0) return;
    this.spent += actualUsd;
  }

  /** Have we already hit or exceeded the cap? */
  isExhausted(): boolean {
    return this.spent >= this.cap;
  }
}