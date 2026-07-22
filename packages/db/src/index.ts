/**
 * @careeros/db — Prisma client re-export + Prisma-backed store implementations.
 *
 * The generated Prisma client lives at @prisma/client (requires `prisma generate`).
 * Store implementations in ./stores/ wrap the client behind the interfaces defined
 * in their respective owning packages (capability-gate, observability, connectors,
 * apps/api identity).
 *
 * Import boundary: only @careeros/db and its consumers (apps/api, connectors, memory)
 * touch these stores. agents and web never import @careeros/db.
 */

export { PrismaClient } from '@prisma/client';
export { SOURCE_REGISTRY_SEED, type SourceRegistrySeedRow } from './seed-data.js';

export { PrismaApprovalTokenStore } from './stores/prisma-approval-token-store.js';
export { PrismaAuditSink } from './stores/prisma-audit-sink.js';
export {
  PrismaAuditReadStore,
  type AuditRowLike,
  type AuditReadPortShape,
} from './stores/prisma-audit-read-store.js';
export { PrismaSourceRegistry } from './stores/prisma-source-registry.js';
export { PrismaUserRepo, PrismaUserSettingsRepo, PrismaUserLifecycleRepo } from './stores/prisma-identity-repos.js';
export { PrismaProfileRepo } from './stores/prisma-profile-repo.js';
export {
  PrismaProfileReader,
  PrismaEpisodicStore,
  PrismaSemanticStore,
} from './stores/prisma-memory-stores.js';
export { PrismaGraphStore } from './stores/prisma-graph-store.js';
export { PrismaOpportunityStore } from './stores/prisma-opportunity-store.js';
export {
  PrismaOpportunityReadStore,
  type OpportunityDetail,
  type OpportunityFilters,
  type OpportunityListItem,
  type OpportunityPage,
} from './stores/prisma-opportunity-read-store.js';
export {
  PrismaMatchScoreStore,
  type MatchScoreLike,
  type MatchScoreStorePort,
  type MatchSubscoreLike,
} from './stores/prisma-match-score-store.js';
export { PrismaProfileResolver, type ProfileResolverPort } from './stores/prisma-profile-resolver.js';
export {
  PrismaBriefingStore,
  type BriefingItemLike,
  type BriefingItemKindLike,
  type BriefingItemStateLike,
  type BriefingRunDetailLike,
  type BriefingRunLike,
  type BriefingStatusLike,
  type BriefingStepRecordLike,
  type BriefingStorePortShape,
  type BriefingTriggerLike,
} from './stores/prisma-briefing-store.js';
export {
  PrismaApplicationStore,
  PrismaOpportunityExists,
  type ApplicationStorePortShape,
  type ApplicationLike,
  type ApplicationDetailLike,
  type ApplicationTimelineEntryLike,
  type ApplicationFollowUpLike,
  type ApplicationUpdateCommandLike,
  type ApplicationStatusLike,
  type ApplicationActorLike,
} from './stores/prisma-application-store.js';
export {
  PrismaStrategyPlanStore,
  type StrategyPlanStorePortShape,
  type StrategyPlanRecordLike,
  type PlanActionRecordLike,
  type PersistPlanLike,
  type PersistPlanActionLike,
  type PlanHorizonLike,
  type PlanStatusLike,
  type PlanActionKindLike,
  type PlanActionStatusLike,
} from './stores/prisma-strategy-plan-store.js';
export {
  PrismaDashboardMetricStore,
  type DashboardMetricStorePortShape,
  type DashboardMetricRecordLike,
  type DashboardMetricStatusLike,
  type DashboardMetricTrendLike,
  type PersistDashboardMetricLike,
} from './stores/prisma-dashboard-metric-store.js';
export {
  PrismaSkillGapStore,
  type SkillGapStorePortShape,
  type SkillGapRowLike,
  type SkillGapWriteLike,
  type LearningItemRowLike,
} from './stores/prisma-skill-gap-store.js';
export {
  PrismaGapSignalReadStore,
  type GapSignalReadPortShape,
  type GapMatchSignalLike,
} from './stores/prisma-gap-signal-read-store.js';


