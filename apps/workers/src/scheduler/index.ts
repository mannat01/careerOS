/**
 * @careeros/workers — scheduler + overnight loop (M07 Step 4).
 *
 * The scheduler is BullMQ + Redis at the outer boundary; this module publishes
 * the pure, testable core (schedule / budget / idempotency / research→plan
 * hook / overnight loop). The BullMQ wiring composes these with concrete
 * adapters in `apps/api/src/app/bootstrap.ts` when the overnight worker
 * process is stood up.
 *
 * Public surface is intentionally SMALL — everything the app-side composition
 * root needs to wire the loop, nothing more.
 */
export {
  isEligibleForRun,
  parseHHMM,
  reasonForSuppression,
  runDayKey,
  wallClockInTz,
  withinQuietHours,
  type UserBriefingSchedule,
} from './schedule.js';

export {
  DAILY_LLM_CAP_USD,
  RunBudget,
  capForTier,
  type SubscriptionTier,
} from './budget.js';

export {
  InMemoryIdempotencyStore,
  briefingIdempotencyKey,
  type IdempotencyStorePort,
} from './idempotency.js';

export {
  findingToChange,
  runResearchPlanHook,
  type PlanRegeneratorPort,
  type ResearchFindingLike,
  type ResearchPlanHookResult,
} from './research-plan-hook.js';

export {
  DASHBOARD_MAINTENANCE_DEFAULTS,
  refreshStaleDashboards,
  type DashboardMaintenanceDeps,
  type DashboardMaintenanceInput,
  type DashboardMaintenanceResult,
  type DashboardRecomputePort,
  type MaintenanceAuditPort,
  type StaleDashboardListPort,
} from './dashboard-maintenance.js';

export {
  runOvernightLoop,
  type AuditPort,
  type BriefingComposerPort,
  type ComposedBriefing,
  type OvernightLoopComplete,
  type OvernightLoopDeps,
  type OvernightLoopDuplicate,
  type OvernightLoopInput,
  type OvernightLoopResult,
  type OvernightLoopSuppressed,
  type PlanChangeEvent,
  type ResearchFindingReadPort,
} from './overnight-loop.js';