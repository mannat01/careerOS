 
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Env } from '@careeros/config';
import { createAuditClient } from '@careeros/observability';
import {
  PrismaApprovalTokenStore,
  PrismaAuditSink,
  PrismaClient,
  PrismaEpisodicStore,
  PrismaGraphStore,
  PrismaMatchScoreStore,
  PrismaOpportunityReadStore,
  PrismaProfileReader,
  PrismaProfileRepo,
  PrismaProfileResolver,
  PrismaSemanticStore,
  PrismaUserLifecycleRepo,
  PrismaUserRepo,
  PrismaUserSettingsRepo,
  PrismaApplicationStore,
  PrismaOpportunityExists,
  PrismaBriefingStore,
  PrismaAuditReadStore,
  PrismaStrategyPlanStore,
  PrismaDashboardMetricStore,
  PrismaSkillGapStore,
  PrismaGapSignalReadStore,
} from '@careeros/db';

import { createLlmGateway, AnthropicProvider } from '@careeros/llm-gateway';
import { LlmExtractionAgent } from '@careeros/agents';
import { MemoryService, GraphMemoryService, FakeEmbedder, FakeLlmProvider } from '@careeros/memory';
import {
  InMemoryResumeModelStore,
  InMemoryResumeVariantStore,
  LlmMatchScorerAgent,
  LlmTailorAgent,
  MatchScorerService,
  ResumeService,
  SequentialIdGen,
} from '@careeros/cie-resume';
import { CareerStateService, InMemoryStateStore, LlmStateUpdaterAgent } from '@careeros/cie-state';
import {
  LlmOfferComparisonAgent,
  LlmStrategicReasonerAgent,
  OfferComparisonService,
  StrategicReasonerService,
} from '@careeros/cie-reasoning';
import { LlmStrategicPlannerAgent, StrategicPlannerService } from '@careeros/cie-planner';
import { GapAnalyzerService } from '@careeros/cie-skills';
import { LlmDrafterAgent, DraftingService } from '@careeros/cie-drafting';
import {
  DashboardMetricComposerService,
  LlmDashboardMetricComposerAgent,
} from '@careeros/cie-metrics';
import { GraphMemoryServiceAdapter } from '../modules/cie/graph.handlers.js';
import {
  MemoryReasonerFactAdapter,
  StateServiceReasonerAdapter,
} from '../modules/cie/decide.handlers.js';
import {
  MemoryStateEventAdapter,
  MemoryStateEvidenceAdapter,
  MemoryStateFactAdapter,
} from '../modules/cie/state.handlers.js';
import { MemoryResumeFactAdapter } from '../modules/cie/resume.handlers.js';
import {
  GraphMemoryPlannerAdapter,
  MemoryPlannerFactAdapter,
  PlanEpisodicMemoryAdapter,
  StateServicePlannerAdapter,
  StateServicePlannerGoalAdapter,
} from '../modules/cie/plan.adapters.js';
import {
  ApplicationHistoryMetricAdapter,
  ComposedMetricEvidenceAdapter,
  DashboardComposerAdapter,
  GraphMemoryMetricGraphAdapter,
  ResearchFindingMetricAdapter,
  StateServiceMetricStateAdapter,
  StrategyPlanMetricPlanAdapter,
} from '../modules/cie/dashboard.adapters.js';
import {
  GapSignalMatchAdapter,
  StateServiceGapStateAdapter,
  GapSignalTargetRoleAdapter,
  PersistedSkillGapPlannerGapReader,
} from '../modules/cie/skills.adapters.js';
import {
  CompositeDraftEvidenceAdapter,
  GraphMemoryDraftGraphAdapter,
  MemoryDraftProfileAdapter,
  OpportunityDraftAdapter,
  StateServiceDraftStateAdapter,
} from '../modules/cie/drafts.adapters.js';
import {
  InMemoryDraftStore,
  StaticChannelPolicy,
  type DraftRecord,
} from '../modules/cie/drafts.handlers.js';
import type {
  ResearchFindingReadPort,
  PersistedResearchFinding,
} from '../modules/cie/research.handlers.js';
import { recomputeAndPersist as recomputeAndPersistDashboard } from '../modules/cie/dashboard.handlers.js';
import { ApplicationMemoryServiceAdapter } from '../modules/application/memory-adapter.js';
import type { ApplicationDashboardRecomputePort } from '../modules/application/application.handlers.js';
import type {
  TwinHandlerDeps,
  TwinMemoryPort,
  TwinProfilePort,
  TwinReasonerPort,
} from '../modules/twin/twin.handlers.js';
import { AppModule } from './app.module.js';
import type { AppDeps } from './deps.js';
import type { AuthProvider } from '../common/auth/auth-provider.js';
import { DevAuthProvider } from '../common/auth/dev-auth-provider.js';
import { ClerkAuthProvider } from '../common/auth/clerk-auth-provider.js';
import { InMemoryObjectStorage, type ObjectStorage } from '../common/storage/object-storage.js';
import { MinioObjectStorage } from '../common/storage/minio-object-storage.js';
import { BullMqExportQueue, type ExportQueue } from '../common/queue/export-queue.js';
import { AgentExtractionAdapter } from '../modules/profile/extractor-adapter.js';
import { MemoryServiceEventAdapter } from '../modules/profile/memory-adapter.js';
import { makeUserAutonomyResolver } from '../common/capability-gate/user-autonomy-resolver.js';


/**
 * Composition root — the ONLY place where concrete implementations are chosen
 * and constructed from env. Everything downstream receives interfaces.
 */
export function buildDepsFromEnv(env: Env, overrides?: Partial<AppDeps>): AppDeps {
  const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });

  const authProvider: AuthProvider =
    overrides?.authProvider ??
    (env.AUTH_PROVIDER === 'dev' ? new DevAuthProvider(env.DEV_AUTH_SECRET) : new ClerkAuthProvider());

  const storage: ObjectStorage =
    overrides?.storage ??
    (env.S3_ENDPOINT && env.S3_ACCESS_KEY && env.S3_SECRET_KEY
      ? new MinioObjectStorage(env.S3_BUCKET, {
          endpoint: env.S3_ENDPOINT,
          accessKey: env.S3_ACCESS_KEY,
          secretKey: env.S3_SECRET_KEY,
        })
      : new InMemoryObjectStorage());

  const exportQueue: ExportQueue = overrides?.exportQueue ?? new BullMqExportQueue(env.REDIS_URL);

  const audit = createAuditClient({ sink: new PrismaAuditSink(prisma) });

  // Extraction agent on the CHEAP tier (ADR-001). The AnthropicProvider is a
  // STUB(M01) until network access exists; extraction runs live behind the
  // FakeLlmProvider in tests via `overrides.profile`.
  const gateway = createLlmGateway({
    provider: new AnthropicProvider(env.ANTHROPIC_API_KEY ?? ''),

    modelsByTier: { cheap: env.LLM_CHEAP_MODEL, frontier: env.LLM_FRONTIER_MODEL },
    pricing: {},
  });
  const extractor = new AgentExtractionAdapter(new LlmExtractionAgent(gateway));

  // Four-tier memory (architecture.md §6). Agents/handlers touch it ONLY through
  // MemoryService; the Prisma stores are the sole code paths to the memory tables.
  // Embeddings + distillation are STUB(M02) fakes (deterministic) until real
  // providers are wired.
  const profileReader = new PrismaProfileReader(prisma);
  const memory = new MemoryService({
    profile: profileReader,
    episodic: new PrismaEpisodicStore(prisma),
    semantic: new PrismaSemanticStore(prisma),
    embedder: new FakeEmbedder(),
    summarizer: new FakeLlmProvider(),
  });

  // Career State Model (database-schema.md §cie). The StateUpdater runs on the
  // FRONTIER tier (state synthesis is strategic reasoning) behind the same
  // gateway; its deterministic guardrails (packages/cie/state) are what enforce
  // the demonstrated-vs-inferred + zero-fabrication invariants, not the prompt.
  // The service reaches memory ONLY through the ProfileReader / MemoryService
  // seams below — never @careeros/db. The store is in-memory for now (M02);
  // the Prisma-backed adapter honoring the same StateStore contract lands with
  // the persisted career_state_* tables.
  const stateService = new CareerStateService({
    facts: new MemoryStateFactAdapter(profileReader),
    evidence: new MemoryStateEvidenceAdapter(profileReader),
    store: new InMemoryStateStore(),
    events: new MemoryStateEventAdapter(memory),
    agent: new LlmStateUpdaterAgent(gateway),
  });

  // Resume Tailor (M03). The service reads structured profile facts only through
  // the Memory/ProfileReader seam and persists draft models/variants in-memory
  // until Prisma adapters land. Tailoring runs on the frontier tier behind the
  // deterministic grounding guardrail in @careeros/cie-resume.
  const resumeFacts = new MemoryResumeFactAdapter(profileReader);
  const resumeService = new ResumeService({
    facts: resumeFacts,
    models: new InMemoryResumeModelStore(),
    variants: new InMemoryResumeVariantStore(),
    ids: new SequentialIdGen(),
    agent: new LlmTailorAgent(gateway),
  });

  // Match Scorer / Explainer (M03). Shares the profile-facts port with Tailor,
  // runs on the frontier tier, and the deterministic `groundMatchScore`
  // guardrail is what enforces the honest-band / no-fabrication invariants.
  const matchScorerService = new MatchScorerService({
    facts: resumeFacts,
    agent: new LlmMatchScorerAgent(gateway),
  });

  // Strategic Reasoner (M05). Advisory Green: derives a grounded DecisionContract
  // from the caller's real profile + real state model. Reads via the narrow
  // ReasonerFactPort / ReasonerStatePort seams (Memory/ProfileReader +
  // CareerStateService) — never @careeros/db from the agent boundary. Runs on
  // the frontier tier; the deterministic `groundContract` guardrail is what
  // enforces evidence-grounded + honest + calibrated invariants.
  const strategicReasonerService = new StrategicReasonerService({
    facts: new MemoryReasonerFactAdapter(profileReader),
    state: new StateServiceReasonerAdapter(stateService),
    agent: new LlmStrategicReasonerAgent(gateway),
  });

  // Offer Comparison (M05 Stage-5). Advisory Green: derives an objective,
  // grounded OfferComparison from the caller's REAL stated values + REAL
  // offers. Runs on the frontier tier; the deterministic
  // `groundOfferComparison` guardrail is what enforces
  // no-invented-preferences / no-fabricated-perks / no-phantom-refs.
  const offerComparisonService = new OfferComparisonService({
    agent: new LlmOfferComparisonAgent(gateway),
  });

  // Career Knowledge Graph (database-schema.md §cie). Agents/handlers touch it
  // ONLY through GraphMemoryService; the PrismaGraphStore is the sole code path
  // to the graph_nodes / graph_edges tables. Node embeddings use the same
  // deterministic FakeEmbedder as the memory tiers (STUB(M02)).
  const graph = new GraphMemoryService(new PrismaGraphStore(prisma), new FakeEmbedder());

  // Strategic Planner (M06 Stage-6). Advisory Green: derives a grounded plan
  // set from the caller's real profile facts + state model + explicitly stated
  // goals + career graph. Runs on the frontier tier; the deterministic
  // guardrails in @careeros/cie-planner enforce ladder-to-stated-goals,
  // resolvable-target-nodes, and the §4A anti-thrash regeneration gate. The
  // handler in modules/cie/plan.handlers.ts persists per-horizon via the
  // narrow StrategyPlanStorePort (PrismaStrategyPlanStore) and appends ONE
  // MemoryEvent per material regeneration; sub-threshold changes never write.
  // M09 Step 3 — the persisted SkillGap rows (deterministic GapAnalyzer
  // output, integrity-verified) feed the planner's EXISTING gap intake via
  // the reader below; the planner keeps grounding gap actions to real nodes.
  const skillGapStore = new PrismaSkillGapStore(prisma);
  const plannerGapReader = new PersistedSkillGapPlannerGapReader(
    skillGapStore,
    new PrismaProfileResolver(prisma),
    graph,
  );
  const strategicPlannerService = new StrategicPlannerService({
    facts: new MemoryPlannerFactAdapter(profileReader),
    state: new StateServicePlannerAdapter(stateService),
    goals: new StateServicePlannerGoalAdapter(stateService),
    graph: new GraphMemoryPlannerAdapter(graph, plannerGapReader),
    agent: new LlmStrategicPlannerAgent(gateway),
  });

  const identityDeps = overrides?.identity ?? {
    users: new PrismaUserRepo(prisma),
    settings: new PrismaUserSettingsRepo(prisma),
    lifecycle: new PrismaUserLifecycleRepo(prisma),
  };

  // M08 Step 3 — build the Intelligence Dashboard deps FIRST so the M04
  // application handler can be wired with the change-hook recompute port
  // (a new application / meaningful status change re-materializes the
  // caller's dashboard, so freshness moves per the recompute-trigger
  // contract). Cheap best-effort recompute; failure never fails the caller.
  const dashboardsDeps = buildDashboardDeps({
    prisma,
    stateService,
    graph,
    gateway,
    strategicPlannerService,
  });
  const dashboardRecomputeAdapter: ApplicationDashboardRecomputePort = {
    recompute: async (userId) => {
      const profileId = await dashboardsDeps.profileResolver.resolveProfileId(userId);
      if (!profileId) return;
      await recomputeAndPersistDashboard(userId, profileId, dashboardsDeps);
    },
  };

  return {
    authProvider,
    identity: identityDeps,
    profile: overrides?.profile ?? {
      extractor,
      profiles: new PrismaProfileRepo(prisma),
      memory: new MemoryServiceEventAdapter(memory),
    },
    cie: overrides?.cie ?? { graph: new GraphMemoryServiceAdapter(graph) },
    state: overrides?.state ?? { service: stateService },
    resume: overrides?.resume ?? { service: resumeService },
    match: overrides?.match ?? { service: matchScorerService },
    decide: overrides?.decide ?? { service: strategicReasonerService },
    decideOffers: overrides?.decideOffers ?? { service: offerComparisonService },
    // M04 discovery reads + discovery-time scoring. The read + match stores are
    // the sole @careeros/db seams; the REUSED M03 MatchScorerService produces the
    // honest, grounded MatchScore, persisted per (profile, opportunity, model).
    opportunity: overrides?.opportunity ?? {
      read: new PrismaOpportunityReadStore(prisma),
      matchStore: new PrismaMatchScoreStore(prisma),
      profiles: new PrismaProfileResolver(prisma),
      scorer: matchScorerService,
    },
    // M04 Stage 4 application pipeline (CRM). The store is the sole @careeros/db
    // seam; the memory adapter appends ONE episodic MemoryEvent per meaningful
    // status change. The applied-only-by-user invariant lives in the pure
    // status-machine the handler runs before any write. The optional
    // `dashboards` recompute hook is wired below (after dashboardsDeps is
    // built) so a new application / meaningful status change re-materializes
    // the caller's dashboard freshness.
    application: overrides?.application ?? {
      store: new PrismaApplicationStore(prisma),
      opportunities: new PrismaOpportunityExists(prisma),
      memory: new ApplicationMemoryServiceAdapter(memory),
      dashboards: dashboardRecomputeAdapter,
    },
    // M05 Stage-5 Step-5 manual Briefing orchestrator. Reuses the existing
    // scored-opportunity + state-model + strategic-reasoner services — the only
    // NEW @careeros/db seam is the PrismaBriefingStore for BriefingRun/Item.
    // Idempotent + resilient: a failing step yields a partial briefing (never
    // blank). Advisory Green throughout: items are `proposed`.
    briefing: overrides?.briefing ?? {
      store: new PrismaBriefingStore(prisma),
      opportunities: new PrismaOpportunityReadStore(prisma),
      profiles: new PrismaProfileResolver(prisma),
      scorer: matchScorerService,
      reasoner: strategicReasonerService,
      state: stateService,
      audit,
    },
    // M05 Step 4 Twin conversational surface. All three ports are thin
    // adapters over EXISTING services — no new @careeros/db imports here,
    // no new stores. The narrow-port shapes live in twin.handlers.ts.
    twin: overrides?.twin ?? buildTwinDeps({
      memory,
      profileResolver: new PrismaProfileResolver(prisma),
      reasoner: strategicReasonerService,
      audit,
    }),
    // M06 Stage-6 Step-3 Strategy Plan endpoints. Narrow ports: the store is
    // the sole @careeros/db seam; the memory adapter appends ONE MemoryEvent
    // per MATERIAL regeneration (sub-threshold is a no-op, so no thrash).
    plan: overrides?.plan ?? {
      service: strategicPlannerService,
      store: new PrismaStrategyPlanStore(prisma),
      memory: new PlanEpisodicMemoryAdapter(memory),
      audit,
    },
    // M08 Step 3 Intelligence Dashboard endpoints. Green/read-only, per-user
    // scoped by construction (userId from the verified request context →
    // profileId via ProfileResolver). Every response carries value + trend +
    // explanation + evidence + linked action + freshness — never a bare
    // number. The composer service is wired to narrow ports whose Prisma
    // adapters live in @careeros/db. Research findings persistence lands in
    // a follow-up; until then the findings port is empty (the composer's
    // guardrail treats no findings as "signal absent", not fabricated).
    dashboards: overrides?.dashboards ?? dashboardsDeps,
    // M09 Step 3 — Skill development endpoints. Green, per-user scoped. The
    // GapAnalyzerService reaches match signals / state model / target roles
    // ONLY via narrow ports (adapters below); the Prisma stores are the sole
    // @careeros/db seams. The analyzer's deterministic guardrail guarantees
    // no invented gaps, never a skill the user already demonstrates, and
    // every LearningItem linked to a real gap — before anything persists.
    skills: overrides?.skills ?? {
      store: skillGapStore,
      profileResolver: new PrismaProfileResolver(prisma),
      analyzer: new GapAnalyzerService({
        matches: new GapSignalMatchAdapter(
          new PrismaGapSignalReadStore(prisma),
          new PrismaProfileResolver(prisma),
        ),
        state: new StateServiceGapStateAdapter(stateService),
        targets: new GapSignalTargetRoleAdapter(
          new PrismaGapSignalReadStore(prisma),
          new PrismaProfileResolver(prisma),
        ),
      }),
      // Reuses the M08 recompute path: a fresh gap set re-materializes the
      // caller's dashboard skill metrics. Best-effort inside the handler.
      dashboards: {
        recompute: async (userId: string) => {
          const pid = await dashboardsDeps.profileResolver.resolveProfileId(userId);
          if (!pid) return;
          await recomputeAndPersistDashboard(userId, pid, dashboardsDeps);
        },
      },
    },

    // M09 Step 4 — cover-letter / outreach drafting. The DraftingService
    // reaches profile facts / state model / graph / opportunity / evidence
    // allow-list ONLY via the narrow adapters above — never @careeros/db.
    // Draft generation + read are GREEN; sending is YELLOW (the controller
    // wraps the handler in withCapabilityGate('draft.send')) AND ToS-gated
    // per-channel (capability_denied + manual-send guidance otherwise).
    // The store is in-memory until a Prisma DraftStore lands; the sender is
    // a STUB(M09) that only marks the record sent — a real email connector
    // replaces it behind the same one-method port.
    drafts: overrides?.drafts ?? {
      service: new DraftingService({
        profile: new MemoryDraftProfileAdapter(profileReader),
        state: new StateServiceDraftStateAdapter(stateService),
        graph: new GraphMemoryDraftGraphAdapter(graph),
        opportunity: new OpportunityDraftAdapter(new PrismaOpportunityReadStore(prisma)),
        evidence: new CompositeDraftEvidenceAdapter(profileReader, graph),
        agent: new LlmDrafterAgent(gateway),
      }),
      store: new InMemoryDraftStore(),
      channels: new StaticChannelPolicy(),
      sender: {
        // STUB(M09): no live email connector yet. Reaching this point means
        // the Yellow gate consumed a valid token AND the channel ToS permits
        // automated send; the audit trail already records the decision.
        send: async (_userId: string, _draft: DraftRecord, _channel: string) => {},
      },
    },

    gate: overrides?.gate ?? {

      secret: env.APPROVAL_TOKEN_SECRET,
      tokenStore: new PrismaApprovalTokenStore(prisma),
      audit,
    },
    // M07 — approval queue for BriefingItems. SHARE the same tokenStore +
    // secret as the gate above so a minted token is redeemable by any code
    // path that later calls enforce({action: 'briefing.item.execute', ...}).
    approval: overrides?.approval ?? {
      store: overrides?.briefing?.store ?? new PrismaBriefingStore(prisma),
      tokenStore: new PrismaApprovalTokenStore(prisma),
      audit,
      approvalSecret: env.APPROVAL_TOKEN_SECRET,
    },
    // M07 — read-only view over the immutable audit log.
    audit: overrides?.audit ?? {
      audit: new PrismaAuditReadStore(prisma),
    },
    // M07 Step 5 — LIVE per-user autonomy resolver. Built from the same
    // UserSettingsRepo the identity module uses, so /v1/me/settings edits are
    // observed by the gate on the very next request (no cache to invalidate).
    userAutonomy: overrides?.userAutonomy ?? makeUserAutonomyResolver(identityDeps.settings),
    storage,
    exportQueue,
  };
}

/**
 * Twin-deps helper. Adapts the concrete MemoryService, ProfileResolver, and
 * StrategicReasonerService onto the narrow ports the Twin handler depends on.
 * Keeps ports one-method-wide + Prisma imports confined to this file.
 */
function buildTwinDeps(input: {
  memory: MemoryService;
  profileResolver: PrismaProfileResolver;
  reasoner: StrategicReasonerService;
  audit: ReturnType<typeof createAuditClient>;
}): TwinHandlerDeps {
  const memoryPort: TwinMemoryPort = {
    retrieve: (task) => input.memory.retrieve(task),
  };
  const profilePort: TwinProfilePort = {
    resolveProfileId: (userId) => input.profileResolver.resolveProfileId(userId),
  };
  const reasonerPort: TwinReasonerPort = {
    decide: (userId, question, opportunity) =>
      input.reasoner.decide(userId, question, opportunity),
  };
  return {
    memory: memoryPort,
    profiles: profilePort,
    reasoner: reasonerPort,
    audit: input.audit,
  };
}

/**
 * M08 Step 3 — Intelligence Dashboard deps helper. Composes the
 * DashboardMetricComposerService with narrow adapters over the LIVE state
 * service, graph, strategy plan store, application store, and profile
 * resolver — plus a stubbed research-findings port (persistence lands with a
 * follow-up). Also injects an evidence resolver that hydrates raw evidence
 * refs into `ResolvedEvidence` shapes the drill-down endpoint returns, and a
 * plan-action resolver that titles the linkedActionId. Prisma imports stay
 * confined to this file.
 */
function buildDashboardDeps(input: {
  prisma: PrismaClient;
  stateService: CareerStateService;
  graph: GraphMemoryService;
  gateway: ReturnType<typeof createLlmGateway>;
  strategicPlannerService: StrategicPlannerService;
}) {
  const applicationStore = new PrismaApplicationStore(input.prisma);
  const strategyPlanStore = new PrismaStrategyPlanStore(input.prisma);

  const stateAdapter = new StateServiceMetricStateAdapter(input.stateService);
  const graphAdapter = new GraphMemoryMetricGraphAdapter(input.graph);
  const historyAdapter = new ApplicationHistoryMetricAdapter(applicationStore);
  const plansAdapter = new StrategyPlanMetricPlanAdapter(strategyPlanStore);

  // Research findings persistence isn't wired in bootstrap yet; the port
  // returns an empty list so the composer treats "no findings" as
  // signal-absent and produces `insufficient_data` where a finding was
  // required — never a fabricated value. Wiring the PrismaResearchFindingStore
  // is a follow-up that will replace this stub without touching the composer.
  const findingsStub: ResearchFindingReadPort = {
    listFindings: () => Promise.resolve([]),
    listFindingsAffectingUser: () => Promise.resolve([] as PersistedResearchFinding[]),
  };
  const findingsAdapter = new ResearchFindingMetricAdapter(findingsStub);

  const evidence = new ComposedMetricEvidenceAdapter({
    state: stateAdapter,
    graph: graphAdapter,
    findings: findingsAdapter,
    plans: plansAdapter,
  });

  const composerService = new DashboardMetricComposerService({
    state: stateAdapter,
    graph: graphAdapter,
    findings: findingsAdapter,
    plans: plansAdapter,
    history: historyAdapter,
    evidence,
    agent: new LlmDashboardMetricComposerAgent(input.gateway),
  });

  return {
    store: new PrismaDashboardMetricStore(input.prisma),
    profileResolver: new PrismaProfileResolver(input.prisma),
    composer: new DashboardComposerAdapter(composerService),
    evidenceResolver: {
      resolve: async (userId: string, refs: string[]) => {
        // Hydrate refs by looking up graph nodes + plan actions the caller
        // owns. Any ref that doesn't resolve is returned as-is with kind
        // `unknown` — the composer already filtered against the allow-list
        // at write time, so this only trims the label surface.
        const nodes = await input.graph.listNodes(userId);
        const nodeById = new Map(nodes.map((n) => [n.id, n]));
        const activePlans = await strategyPlanStore.getActivePlans(userId);
        const actionById = new Map<string, { title: string }>();
        for (const p of activePlans) {
          for (const a of p.actions) actionById.set(a.id, { title: a.title });
        }
        return refs.map((ref) => {
          const node = nodeById.get(ref);
          if (node) return { ref, kind: node.kind, label: node.label };
          const action = actionById.get(ref);
          if (action) return { ref, kind: 'plan_action', label: action.title };
          return { ref, kind: 'unknown', label: ref };
        });
      },
    },
    planActionResolver: {
      resolveTitle: async (userId: string, actionId: string) => {
        const plans = await strategyPlanStore.getActivePlans(userId);
        for (const p of plans) {
          for (const a of p.actions) if (a.id === actionId) return a.title;
        }
        return null;
      },
    },
  };
}

/** Create (but do not listen) a Nest application bound to the given deps. */
export async function createApp(deps: AppDeps): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(deps), { logger: ['warn', 'error'] });
  return app;
}
