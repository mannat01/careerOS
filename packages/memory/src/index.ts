/**
 * @careeros/memory — the four-tier Memory service (architecture.md §6). This is
 * the SINGLE interface agents call for memory; only this package touches the
 * memory tables (via injected store ports whose Prisma adapters live in
 * @careeros/db). Agents must never import @careeros/db directly (enforced by the
 * agentBoundary lint overlay).
 *
 * Tiers: profile (structured/authoritative) · episodic (MemoryEvent, append-only)
 * · semantic (DerivedInsight, regenerable/non-authoritative) · working (the
 * per-task slice assembled under a HARD token budget).
 */
export {
  MemoryService,
  totalMemoryItems,
  type MemoryServiceOptions,
  type RetrieveTask,
} from './service.js';
export {
  FakeEmbedder,
  cosineSimilarity,
  type Embedder,
} from './embedder.js';
export { FakeLlmProvider } from './summarizer.js';
export { estimateTokens } from './budget.js';
export {
  InMemoryProfileReader,
  InMemoryEpisodicStore,
  InMemorySemanticStore,
} from './fakes.js';
export type {
  FactKind,
  ProfileFact,
  ProfileReader,
  MemoryEventType,
  MemoryEvent,
  MemoryEventInput,
  EpisodicStore,
  DerivedInsight,
  DerivedInsightInput,
  SemanticStore,
  SliceEntryTier,
  WorkingSliceEntry,
  WorkingSlice,
  Summarizer,
} from './types.js';
