
import type { EnforceDeps } from '@careeros/capability-gate';
import type { AuthProvider } from '../common/auth/auth-provider.js';
import type { UserAutonomyResolver } from '../common/capability-gate/gate-interceptor.js';
import type { IdentityDeps } from '../modules/identity/me.handlers.js';
import type { ProfileImportDeps } from '../modules/profile/import.handlers.js';
import type { GraphQueryDeps } from '../modules/cie/graph.handlers.js';
import type { DecideHandlerDeps } from '../modules/cie/decide.handlers.js';
import type { DecideOffersHandlerDeps } from '../modules/cie/decide-offers.handlers.js';
import type { MatchHandlerDeps, ResumeHandlerDeps } from '../modules/cie/resume.handlers.js';
import type { StateHandlerDeps } from '../modules/cie/state.handlers.js';
import type { OpportunityHandlerDeps } from '../modules/opportunity/opportunity.handlers.js';
import type { ApplicationHandlerDeps } from '../modules/application/application.handlers.js';
import type { TwinHandlerDeps } from '../modules/twin/twin.handlers.js';
import type { BriefingHandlerDeps } from '../modules/briefing/briefing.handlers.js';
import type { ApprovalHandlerDeps } from '../modules/briefing/approval.handlers.js';
import type { AuditHandlerDeps } from '../modules/audit/audit.handlers.js';
import type { PlanHandlerDeps } from '../modules/cie/plan.handlers.js';
import type { DashboardHandlerDeps } from '../modules/cie/dashboard.handlers.js';
import type { SkillsHandlerDeps } from '../modules/cie/skills.handlers.js';
import type { DraftsHandlerDeps } from '../modules/cie/drafts.handlers.js';

import type { ObjectStorage } from '../common/storage/object-storage.js';
import type { ExportQueue } from '../common/queue/export-queue.js';


/** Injection token for the app dependency container (explicit @Inject — no metadata emit needed). */
export const APP_DEPS = Symbol('APP_DEPS');

/**
 * AppDeps — the full dependency container assembled by the composition root
 * (main.ts for production, e2e tests for testing). Everything the HTTP layer
 * needs, injected; no service locates its own dependencies.
 */
export interface AppDeps {
  authProvider: AuthProvider;
  identity: IdentityDeps;
  profile: ProfileImportDeps;
  cie: GraphQueryDeps;
  state: StateHandlerDeps;
  resume: ResumeHandlerDeps;
  match: MatchHandlerDeps;
  decide: DecideHandlerDeps;
  decideOffers: DecideOffersHandlerDeps;
  opportunity: OpportunityHandlerDeps;
  application: ApplicationHandlerDeps;
  /**
   * M05 Step 4 — Twin conversational surface. Assembles a min-slice memory
   * context per turn (HARD budget), can invoke the StrategicReasoner as a
   * read tool, and audits every turn. Yellow-in-chat is emitted as
   * `approval_required` and NEVER executed from this path.
   */
  twin: TwinHandlerDeps;
  /**
   * M05 Stage-5 Step-5 — manual Briefing orchestrator. Composes scored
   * opportunities + gaps + a StrategicReasoner focus summary; every step is
   * recorded (status/cost/traceId) on the BriefingRun and mirrored to audit.
   * A failing step yields a partial briefing — never blank.
   */
  briefing: BriefingHandlerDeps;
  /**
   * M07 — approval queue for BriefingItems. Mints/consumes single-use
   * ApprovalTokens bound to (user, `briefing.item.execute`, payloadHash) via
   * the M01 capability-gate. Reuses the same tokenStore + secret as `gate`.
   */
  approval: ApprovalHandlerDeps;
  /**
   * M07 — GET /v1/audit. Read-only projection over the append-only audit log,
   * PER-USER scoped by construction. The write path continues to flow through
   * every handler + the gate; nothing writes here.
   */
  audit: AuditHandlerDeps;
  /**
   * M06 Stage-6 Step-3 — Strategy Plan endpoints. Persists per-horizon plans
   * (30d/90d/1y/3y/5y) with one-active-per-horizon; adaptive regeneration is
   * §4A-gated: material change → supersede + explained diff + MemoryEvent;
   * sub-threshold → no-op (no thrash).
   */
  plan: PlanHandlerDeps;
  /**
   * M08 Step 3 — Intelligence Dashboard endpoints. Green/read-only, per-user
   * scoped by construction. Every response carries explanation + trend +
   * evidence + linked action + freshness — never a bare number. Recompute is
   * driven by change hooks (completed interview, new application) and a
   * periodic refresh in the scheduler's maintenance cadence.
   */
  dashboards: DashboardHandlerDeps;
  /**
   * M09 Step 3 — Skill development endpoints. Green, per-user scoped. The
   * GapAnalyzer computes SkillGaps deterministically (per-opportunity from
   * match subscores; aggregate from low-confidence state dimensions vs stated
   * target roles) and self-verifies: no invented gaps, never a skill the user
   * already demonstrates, every LearningItem links to a real gap.
   */
  skills: SkillsHandlerDeps;
  /**
   * M09 Step 4 — cover-letter / outreach drafting. Draft generation + read
   * are Green (advisory artifact, zero-fabrication guardrail inside the
   * DraftingService). Sending is Yellow: the controller wraps the send
   * handler in withCapabilityGate('draft.send') AND the handler enforces the
   * destination channel's ToS (capability_denied + manual-send guidance when
   * automated send is not permitted).
   */
  drafts: DraftsHandlerDeps;
  gate: EnforceDeps;

  /**
   * M07 Step 5 — per-user autonomy resolver. Interceptor consults this before
   * enforcement so a user's `UserSettings.autonomyDefaults[action]` override
   * TIGHTENS the gate (never loosens). Composition root builds it from the
   * live UserSettingsRepo; tests may pass a bespoke stub.
   */
  userAutonomy: UserAutonomyResolver;

  storage: ObjectStorage;
  exportQueue: ExportQueue;
}

