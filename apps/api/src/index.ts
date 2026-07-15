// apps/api — M01 slice. NOTE(M01): the NestJS runtime is not booted in this sandbox;
// handlers/interceptor are framework-agnostic pure functions the Nest modules will
// bind 1:1 (controller → handler, interceptor → withCapabilityGate). See README.
export { errorResponse, ok, type HandlerResponse } from './common/errors/http-error.js';
export { contextFromVerifiedClaims, type RequestContext } from './common/auth/request-context.js';
export { assertUserScope, scopedWhere, ScopeViolationError } from './common/auth/scope.js';
export { withCapabilityGate } from './common/capability-gate/gate-interceptor.js';
export { deleteMe, getMe, patchMeSettings, type IdentityDeps } from './modules/identity/me.handlers.js';
export {
  InMemoryUserLifecycleRepo,
  InMemoryUserRepo,
  InMemoryUserSettingsRepo,
  type UserLifecycleRepo,
  type UserRepo,
  type UserSettingsRepo,
} from './modules/identity/repos.js';
export {
  importProfile,
  type ExtractionPort,
  type MemoryEventPort,
  type ProfileImportDeps,
} from './modules/profile/import.handlers.js';
export { MemoryServiceEventAdapter } from './modules/profile/memory-adapter.js';
export {
  queryGraph,
  GraphMemoryServiceAdapter,
  type GraphQueryPort,
  type GraphQueryDeps,
  type GraphQueryResponse,
} from './modules/cie/graph.handlers.js';
export {
  getState,
  explainDimension,
  recomputeState,
  MemoryStateFactAdapter,
  MemoryStateEvidenceAdapter,
  MemoryStateEventAdapter,
  type StateHandlerDeps,
} from './modules/cie/state.handlers.js';
export {
  tailorResume,
  getResumeVariant,
  scoreMatch,
  MemoryResumeFactAdapter,
  type ResumeHandlerDeps,
  type MatchHandlerDeps,
} from './modules/cie/resume.handlers.js';
export {
  listOpportunities,
  getOpportunity,
  getOpportunityMatch,
  opportunityToJob,
  type OpportunityDetail,
  type OpportunityFilters,
  type OpportunityHandlerDeps,
  type OpportunityListItem,
  type OpportunityMatch,
  type OpportunityPage,
  type OpportunityReadPort,
  type MatchScoreStore,
  type ProfileResolver,
} from './modules/opportunity/opportunity.handlers.js';
export {
  createApplication,
  getApplication,
  listApplications,
  patchApplication,
  scheduleFollowUp,
  resolveActor,
  type ApplicationHandlerDeps,
  type ApplicationStorePort,
  type ApplicationUpdateCommand,
  type ApplicationMemoryPort,
  type OpportunityExistsPort,
} from './modules/application/application.handlers.js';
export {
  APPLICATION_PIPELINE,
  checkTransition,
  isStructurallyValidTransition,
  isMeaningfulStatusChange,
  type TransitionCheck,
  type TransitionDenyReason,
  type TransitionIntent,
} from './modules/application/status-machine.js';
export { ApplicationMemoryServiceAdapter } from './modules/application/memory-adapter.js';
export {
  InMemoryProfileRepo,
  type ProfileRepo,
  type ProfileImportResult,
} from './modules/profile/repos.js';

export { AgentExtractionAdapter } from './modules/profile/extractor-adapter.js';
export { type AuthProvider } from './common/auth/auth-provider.js';

export { DevAuthProvider } from './common/auth/dev-auth-provider.js';
export { ClerkAuthProvider } from './common/auth/clerk-auth-provider.js';
export { resolveBearerToken } from './common/auth/auth-guard.js';
