
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
import { ApplicationMemoryServiceAdapter } from '../modules/application/memory-adapter.js';
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

  return {
    authProvider,
    identity: overrides?.identity ?? {
      users: new PrismaUserRepo(prisma),
      settings: new PrismaUserSettingsRepo(prisma),
      lifecycle: new PrismaUserLifecycleRepo(prisma),
    },
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
    // status-machine the handler runs before any write.
    application: overrides?.application ?? {
      store: new PrismaApplicationStore(prisma),
      opportunities: new PrismaOpportunityExists(prisma),
      memory: new ApplicationMemoryServiceAdapter(memory),
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

    gate: overrides?.gate ?? {

      secret: env.APPROVAL_TOKEN_SECRET,
      tokenStore: new PrismaApprovalTokenStore(prisma),
      audit,
    },
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

/** Create (but do not listen) a Nest application bound to the given deps. */
export async function createApp(deps: AppDeps): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(deps), { logger: ['warn', 'error'] });
  return app;
}
