/**
 * M07 Step 4 — the OVERNIGHT LOOP (scheduled §8 sequence).
 *
 * This module IS the scheduled daily automation: it executes the PRD §8
 * sequence over the existing CIE capabilities — refresh context → discover /
 * score opportunities → identify gaps → research refresh → strategic focus →
 * compose BriefingRun — REUSING the manual-briefing orchestration (via a
 * narrow `BriefingComposerPort`) rather than reimplementing it. The composer
 * lives in `apps/api/src/modules/briefing/briefing.handlers.ts` and is
 * exposed to the loop as a port so this file stays DB-free + testable.
 *
 * Discipline (docs/milestone-07.md acceptance criteria):
 *
 *  - **Quiet-hours honored**: `runOvernightLoop` NEVER runs inside quiet
 *    hours; when suppressed, it returns `{ suppressed: 'quiet_hours' }` and
 *    the caller records that fact in the audit trail (no BriefingRun row is
 *    written — a suppressed slot is not the same as a partial briefing).
 *
 *  - **Idempotent per (user, day)**: the loop claims a (userId, runDayKey)
 *    idempotency key BEFORE composing. A duplicate trigger loses the claim
 *    and returns the SAME briefing id — never composes a second one.
 *
 *  - **Partial-failure resilience**: composition is delegated to the manual-
 *    briefing composer, which already yields a PARTIAL BriefingRun on step
 *    failure (never blank). This module reports the composer's outcome
 *    verbatim + layers on research→plan-hook and budget metering.
 *
 *  - **Research→plan hook**: after composition, the loop asks the research
 *    port for the day's findings and runs the hook (single §4A source of
 *    truth via @careeros/cie-planner's `isMaterialChange`). High-impact
 *    findings regenerate the plan with an explained diff; low-impact ones
 *    do not (anti-thrash).
 *
 *  - **Cost cap (ADR-003)**: a per-user daily LLM budget is enforced via the
 *    `RunBudget` accountant. When exhausted, the research→plan hook is
 *    PARKED (recorded as budget-skipped, not failed). This module never
 *    blocks composition on budget — the composer's own metering is what
 *    stops before the cap; here we degrade the OPTIONAL expensive tail
 *    (plan regeneration) gracefully.
 *
 *  - **Autonomy**: this loop only PREPARES. It never executes a Yellow
 *    action; the composer already emits items as `proposed`. The approval
 *    queue is Step 5.
 */
import type { PlanChangeEvent } from '@careeros/cie-planner';
import {
  briefingIdempotencyKey,
  type IdempotencyStorePort,
} from './idempotency.js';
import {
  isEligibleForRun,
  reasonForSuppression,
  runDayKey,
  type UserBriefingSchedule,
} from './schedule.js';
import { RunBudget } from './budget.js';
import {
  runResearchPlanHook,
  type PlanRegeneratorPort,
  type ResearchFindingLike,
  type ResearchPlanHookResult,
} from './research-plan-hook.js';

// ---------------- narrow ports ----------------

/**
 * The composer port — the SEAM to reuse the manual-briefing orchestration.
 * Concrete adapter (app-side) wraps `runManualBriefing` and passes back the
 * composed run's audit-friendly summary. The composer OWNS partial-failure
 * discipline (a step failure yields a partial run, never blank).
 */
export interface BriefingComposerPort {
  compose(input: {
    userId: string;
    trigger: 'scheduled';
    runDayKey: string;
    traceId: string;
  }): Promise<ComposedBriefing>;
}

/**
 * The composer's returned summary — a superset of what the loop needs to
 * report + persist to audit. Deliberately narrow (no PII, no payloads).
 */
export interface ComposedBriefing {
  briefingRunId: string;
  status: 'complete' | 'partial' | 'failed';
  itemCount: number;
  costUsd: number;
  /** Per-step summary. `retryable` flags a `failed` step for a follow-up job. */
  steps: Array<{
    name: string;
    status: 'ok' | 'failed' | 'skipped';
    costUsd: number;
    itemsProduced: number;
    error?: string;
    retryable?: boolean;
  }>;
}

/**
 * Read port for the day's research findings — the loop asks this after
 * composition to decide whether any material findings warrant plan
 * regeneration. This is a NARROW view of the finding row (only what §4A
 * cares about); the full store lives in @careeros/db.
 */
export interface ResearchFindingReadPort {
  listRecentFindingsAffectingUser(input: {
    userId: string;
    limit: number;
  }): Promise<ResearchFindingLike[]>;
}

/** Audit port — narrow; the app-side adapter wraps `AuditClient.append`. */
export interface AuditPort {
  append(input: {
    userId: string;
    action: string;
    reason: string;
    traceId: string;
    target?: string;
  }): Promise<void>;
}

// ---------------- request / response ----------------

export interface OvernightLoopInput {
  userId: string;
  /** The user's tier — enforced against ADR-003 cap. */
  subscriptionTier: 'free' | 'pro';
  /** Per-user schedule (timezone + quiet hours + daily-at). */
  schedule: UserBriefingSchedule;
  /** Wall-clock "now" — injected so tests are deterministic. */
  now: Date;
  /** Trace id — carried into composition + audit. */
  traceId: string;
  /**
   * Optional cap override for tests. Prod passes `capForTier(tier)`; tests
   * pass a bespoke value to exercise budget-exhaustion.
   */
  dailyCapUsd?: number;
  /**
   * Optional bespoke findings list — the concrete adapter usually calls
   * `research.listRecentFindingsAffectingUser`, but the caller can supply
   * a pre-fetched list (tests + the app orchestrator).
   */
  findings?: ResearchFindingLike[];
  /** Estimated research→plan-hook cost per finding — for budget preflight. */
  costEstimatePerFindingUsd?: number;
}

export type OvernightLoopSuppressed = {
  kind: 'suppressed';
  reason: 'quiet_hours' | 'invalid_schedule';
};

export type OvernightLoopDuplicate = {
  kind: 'duplicate';
  runDayKey: string;
  existingBriefingRunId: string;
};

export type OvernightLoopComplete = {
  kind: 'composed';
  runDayKey: string;
  briefing: ComposedBriefing;
  research: ResearchPlanHookResult[];
  budget: { capUsd: number; spentUsd: number; hookParked: boolean };
};

export type OvernightLoopResult =
  | OvernightLoopSuppressed
  | OvernightLoopDuplicate
  | OvernightLoopComplete;

export interface OvernightLoopDeps {
  composer: BriefingComposerPort;
  research: ResearchFindingReadPort;
  planRegenerator: PlanRegeneratorPort;
  idempotency: IdempotencyStorePort;
  audit: AuditPort;
}

// ---------------- the loop ----------------

const DEFAULT_HOOK_COST_ESTIMATE = 0.001;
const DEFAULT_DAILY_CAP_USD = 0.5;

/**
 * Execute one overnight-loop run for one user. Callers MUST invoke this once
 * per (user, scheduled trigger). It is safe to call more than once for the
 * same (user, day) — the idempotency store guarantees a single BriefingRun.
 *
 * Never throws to the caller — the loop is a scheduled worker; unhandled
 * rejections would poison the queue. All failure modes surface as structured
 * result objects + audit rows.
 */
export async function runOvernightLoop(
  input: OvernightLoopInput,
  deps: OvernightLoopDeps,
): Promise<OvernightLoopResult> {
  const {
    userId,
    subscriptionTier,
    schedule,
    now,
    traceId,
    dailyCapUsd = DEFAULT_DAILY_CAP_USD,
    costEstimatePerFindingUsd = DEFAULT_HOOK_COST_ESTIMATE,
  } = input;

  // ---- 1. Quiet-hours / schedule eligibility -----------------------------
  if (!isEligibleForRun(now, schedule)) {
    const reason = reasonForSuppression(now, schedule) ?? 'quiet_hours';
    await deps.audit.append({
      userId,
      action: 'scheduler.overnight_loop.suppressed',
      reason: `Suppressed: ${reason} (tier=${subscriptionTier}).`,
      traceId,
    });
    return { kind: 'suppressed', reason };
  }

  const dayKey = runDayKey(now, schedule);
  const idempKey = briefingIdempotencyKey(userId, dayKey);

  // ---- 2. Idempotency: first-writer wins per (user, day) -----------------
  //
  // We claim BEFORE calling the composer so a duplicate trigger cannot even
  // start the expensive work. The claim carries a placeholder id — the loop
  // stores the real BriefingRun id downstream so `get` returns something
  // meaningful; but the important invariant is that `claim` returned true.
  const placeholderId = `pending:${userId}:${dayKey}`;
  const claimed = await deps.idempotency.claim(idempKey, placeholderId);
  if (!claimed) {
    const existing = (await deps.idempotency.get(idempKey)) ?? '';
    await deps.audit.append({
      userId,
      action: 'scheduler.overnight_loop.duplicate',
      reason: `Duplicate trigger for (user, day)=${idempKey}; returning existing briefing.`,
      traceId,
      target: existing,
    });
    return { kind: 'duplicate', runDayKey: dayKey, existingBriefingRunId: existing };
  }

  // ---- 3. Compose the briefing (reuses manual-briefing orchestration) ----
  const briefing = await deps.composer.compose({
    userId,
    trigger: 'scheduled',
    runDayKey: dayKey,
    traceId,
  });

  // Overwrite the placeholder with the real BriefingRun id so a follow-up
  // `get(idempKey)` returns the composed run's id. `finalize` is a plain SET
  // — it never gates or blocks (the SETNX invariant was already established
  // by the earlier `claim` call).
  await deps.idempotency.finalize(idempKey, briefing.briefingRunId);

  // ---- 4. Research → plan hook (budget-aware) ----------------------------
  //
  // The composer's cost is metered separately (on the BriefingRun); this
  // module's budget accountant governs the OPTIONAL tail — the research →
  // plan-regeneration hook. When exhausted, the hook is PARKED (not failed).
  const budget = new RunBudget(dailyCapUsd);
  budget.charge(briefing.costUsd);

  const findings =
    input.findings ??
    (await deps.research.listRecentFindingsAffectingUser({ userId, limit: 25 }));

  let hookResults: ResearchPlanHookResult[] = [];
  let hookParked = false;
  const totalHookEstimate = findings.length * costEstimatePerFindingUsd;

  if (budget.canAfford(totalHookEstimate)) {
    hookResults = await runResearchPlanHook(userId, findings, deps.planRegenerator);
    budget.charge(totalHookEstimate);
  } else {
    hookParked = true;
    await deps.audit.append({
      userId,
      action: 'scheduler.overnight_loop.budget_exhausted',
      reason: `Skipped research→plan hook: cap=${dailyCapUsd.toFixed(4)}, spent=${budget.totalSpent().toFixed(4)}, needed=${totalHookEstimate.toFixed(4)} (tier=${subscriptionTier}).`,
      traceId,
      target: briefing.briefingRunId,
    });
  }

  // ---- 5. Audit the whole run --------------------------------------------
  await deps.audit.append({
    userId,
    action: 'scheduler.overnight_loop.composed',
    reason: buildRunAuditReason({
      status: briefing.status,
      dayKey,
      itemCount: briefing.itemCount,
      totalSpent: budget.totalSpent(),
      hookResults,
      hookParked,
    }),
    traceId,
    target: briefing.briefingRunId,
  });

  return {
    kind: 'composed',
    runDayKey: dayKey,
    briefing,
    research: hookResults,
    budget: { capUsd: dailyCapUsd, spentUsd: budget.totalSpent(), hookParked },
  };
}

// ---------------- helpers ----------------

function buildRunAuditReason(input: {
  status: 'complete' | 'partial' | 'failed';
  dayKey: string;
  itemCount: number;
  totalSpent: number;
  hookResults: ResearchPlanHookResult[];
  hookParked: boolean;
}): string {
  const regenerated = input.hookResults.filter((h) => h.regenerated).length;
  const material = input.hookResults.filter((h) => h.material).length;
  const parts = [
    `day=${input.dayKey}`,
    `status=${input.status}`,
    `items=${input.itemCount}`,
    `cost=$${input.totalSpent.toFixed(4)}`,
    `findings=${input.hookResults.length}`,
    `material=${material}`,
    `regenerated=${regenerated}`,
  ];
  if (input.hookParked) parts.push('hook=parked_budget');
  return parts.join(' ');
}

// re-export the change type so app-side adapters can type their calls without
// pulling @careeros/cie-planner directly.
export type { PlanChangeEvent };