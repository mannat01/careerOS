
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
  PrismaProfileReader,
  PrismaProfileRepo,
  PrismaSemanticStore,
  PrismaUserLifecycleRepo,
  PrismaUserRepo,
  PrismaUserSettingsRepo,
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
import { GraphMemoryServiceAdapter } from '../modules/cie/graph.handlers.js';
import {
  MemoryStateEventAdapter,
  MemoryStateEvidenceAdapter,
  MemoryStateFactAdapter,
} from '../modules/cie/state.handlers.js';
import { MemoryResumeFactAdapter } from '../modules/cie/resume.handlers.js';
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

    gate: overrides?.gate ?? {
      secret: env.APPROVAL_TOKEN_SECRET,
      tokenStore: new PrismaApprovalTokenStore(prisma),
      audit,
    },
    storage,
    exportQueue,
  };
}

/** Create (but do not listen) a Nest application bound to the given deps. */
export async function createApp(deps: AppDeps): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(deps), { logger: ['warn', 'error'] });
  return app;
}
