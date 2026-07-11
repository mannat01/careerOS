/**
 * @careeros/memory domain types + tier PORTS (the store interfaces the service
 * depends on). Concrete Prisma-backed adapters live in @careeros/db and implement
 * these — the dependency arrow points INTO memory, never out to @careeros/db, so
 * the "only packages/memory touches memory tables" boundary holds and agents call
 * MemoryService alone (project-structure.md §2, architecture.md §6 four-tier memory).
 */

// ---------------- profile tier (structured facts, authoritative) ----------------

export type FactKind = 'experience' | 'project' | 'education' | 'skill';

/**
 * One authoritative, structured fact read from the identity/profile rows the
 * extractor persisted. `text` is the retrieval/embedding surface; `ref` points
 * back at the owning row so a returned slice is always traceable to source.
 */
export interface ProfileFact {
  kind: FactKind;
  text: string;
  ref: string; // e.g. "experience:<uuid>"
}

/** Read port over the structured profile (identity/profile repos live in the app). */
export interface ProfileReader {
  /** All structured facts for a user's profile, authoritative + current. */
  readFacts(userId: string): Promise<ProfileFact[]>;
}

// ---------------- episodic tier (MemoryEvent, append-only) ----------------

export type MemoryEventType = 'twin_action' | 'user_decision' | 'outcome' | 'system';

export interface MemoryEvent {
  id: string;
  userId: string;
  type: MemoryEventType;
  payload: Record<string, unknown>;
  rationale?: string;
  autonomyTier?: string;
  occurredAt: string; // ISO-8601
}

/** Input to append() — id/occurredAt are assigned by the store. */
export interface MemoryEventInput {
  userId: string;
  type: MemoryEventType;
  payload: Record<string, unknown>;
  rationale?: string;
  autonomyTier?: string;
}

/**
 * Episodic store PORT. APPEND-ONLY BY CONTRACT: it exposes append + read paths
 * ONLY. There is deliberately no update()/delete() — removal happens solely via
 * account hard-delete, mirroring AuditLog (database-schema.md §4). Agents can add
 * to history and read it, but can never rewrite it.
 */
export interface EpisodicStore {
  append(event: MemoryEventInput): Promise<MemoryEvent>;
  /** Most-recent-first, optionally capped. */
  read(userId: string, limit?: number): Promise<MemoryEvent[]>;
}

// ---------------- semantic tier (DerivedInsight, regenerable) ----------------

/**
 * A distilled, NON-AUTHORITATIVE summary of profile + episodic memory. Safe to
 * drop and rebuild (regenerate()). `sourceRefs` link back to the authoritative
 * facts/events it summarized; `freshnessAt` marks how current it is.
 */
export interface DerivedInsight {
  id: string;
  profileId: string;
  statement: string;
  sourceRefs: string[];
  freshnessAt: string; // ISO-8601
  modelVersion?: string;
}

export interface DerivedInsightInput {
  profileId: string;
  statement: string;
  sourceRefs: string[];
  freshnessAt: string;
  modelVersion?: string;
}

/**
 * Semantic store PORT. `replaceAll` is the drop-and-rebuild used by regenerate():
 * it deletes the profile's existing insights and writes the new set in one shot,
 * so a regeneration NEVER mutates source facts — it only recomputes the derived
 * layer.
 */
export interface SemanticStore {
  listByProfile(profileId: string): Promise<DerivedInsight[]>;
  replaceAll(profileId: string, insights: DerivedInsightInput[]): Promise<DerivedInsight[]>;
}

// ---------------- working tier (per-task assembled slice) ----------------

export type SliceEntryTier = 'profile' | 'episodic' | 'semantic';

export interface WorkingSliceEntry {
  tier: SliceEntryTier;
  text: string;
  ref: string;
  /** Estimated token cost of this entry (see estimateTokens). */
  tokens: number;
  /** Retrieval score (higher = more relevant to the task query). */
  score: number;
}

/**
 * The working tier: the bounded, per-task memory slice handed to an agent. It is
 * assembled fresh for each retrieve(task) call and is NEVER the full memory — it
 * is capped by a hard token budget.
 */
export interface WorkingSlice {
  summary: string;
  entries: WorkingSliceEntry[];
  /** Sum of summary + entry token estimates; guaranteed ≤ budget. */
  usedTokens: number;
  budgetTokens: number;
  /** True when some available memory was dropped to honor the budget. */
  truncated: boolean;
}

// ---------------- LLM summarization port ----------------

/**
 * Minimal summarizer PORT so the summarization pass can run on a FakeLlmProvider
 * in unit tests (deterministic, no network) and the real gateway in production.
 */
export interface Summarizer {
  summarize(input: { task: string; facts: string[] }): Promise<string>;
}
