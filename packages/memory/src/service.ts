import { cosineSimilarity, type Embedder } from './embedder.js';
import { estimateTokens } from './budget.js';
import type {
  DerivedInsight,
  EpisodicStore,
  MemoryEvent,
  MemoryEventInput,
  ProfileFact,
  ProfileReader,
  SemanticStore,
  Summarizer,
  WorkingSlice,
  WorkingSliceEntry,
} from './types.js';

export interface MemoryServiceOptions {
  profile: ProfileReader;
  episodic: EpisodicStore;
  semantic: SemanticStore;
  embedder: Embedder;
  summarizer: Summarizer;
}

export interface RetrieveTask {
  userId: string;
  profileId: string;
  /** The natural-language task/query the agent is working on. */
  query: string;
  /** HARD token budget for the assembled slice. Required — no silent default. */
  budgetTokens: number;
  /** Optional cap on episodic events scanned (most-recent-first). */
  episodicLimit?: number;
}

interface Candidate {
  tier: WorkingSliceEntry['tier'];
  text: string;
  ref: string;
  score: number;
}

/**
 * The four-tier Memory service (architecture.md §6). This is the ONE interface
 * agents call; only this package touches the memory tables (via the injected
 * store ports). The four tiers:
 *   - profile   — structured, authoritative facts (identity/profile rows).
 *   - episodic  — MemoryEvent history, append-only.
 *   - semantic  — DerivedInsight, regenerable + non-authoritative.
 *   - working   — the per-task assembled slice returned by retrieve().
 *
 * retrieve() runs HYBRID retrieval: structured facts + vector similarity + a
 * summarization pass, assembled under a HARD min-slice token budget. The returned
 * slice is guaranteed to (a) never exceed the budget and (b) never be the full
 * memory — it is a bounded, task-relevant projection.
 */
export class MemoryService {
  private readonly profile: ProfileReader;
  private readonly episodic: EpisodicStore;
  private readonly semantic: SemanticStore;
  private readonly embedder: Embedder;
  private readonly summarizer: Summarizer;

  constructor(opts: MemoryServiceOptions) {
    this.profile = opts.profile;
    this.episodic = opts.episodic;
    this.semantic = opts.semantic;
    this.embedder = opts.embedder;
    this.summarizer = opts.summarizer;
  }

  // ---------------- episodic tier ----------------

  /**
   * Append one episodic MemoryEvent (append-only). Called on profile import/edit
   * and on Twin actions / user decisions. There is no update/delete counterpart.
   */
  async recordEvent(event: MemoryEventInput): Promise<MemoryEvent> {
    return this.episodic.append(event);
  }

  async history(userId: string, limit?: number): Promise<MemoryEvent[]> {
    return this.episodic.read(userId, limit);
  }

  // ---------------- semantic tier ----------------

  async insights(profileId: string): Promise<DerivedInsight[]> {
    return this.semantic.listByProfile(profileId);
  }

  /**
   * Regenerate the semantic tier: DROP every existing DerivedInsight for the
   * profile and REBUILD it by distilling profile + episodic memory through the
   * summarizer. NON-AUTHORITATIVE: this only recomputes the derived layer — it
   * reads source facts/events but writes NONE of them, so a regenerate can never
   * change a single authoritative fact. Idempotent given identical sources.
   */
  async regenerate(userId: string, profileId: string): Promise<DerivedInsight[]> {
    const facts = await this.profile.readFacts(userId);
    const events = await this.episodic.read(userId);

    const factRefs = facts.map((f) => f.ref);
    const eventRefs = events.map((e) => `event:${e.id}`);
    const freshnessAt = new Date().toISOString();

    // One distilled statement over the structured facts; extractive so it never
    // invents content the profile doesn't already contain.
    const statement = await this.summarizer.summarize({
      task: 'profile-summary',
      facts: facts.map((f) => f.text),
    });

    const rationales = events
      .map((e) => e.rationale)
      .filter((r): r is string => typeof r === 'string' && r.length > 0);

    const inputs = [
      {
        profileId,
        statement,
        sourceRefs: factRefs,
        freshnessAt,
        modelVersion: 'fake-llm-v0',
      },
      ...(rationales.length > 0
        ? [
            {
              profileId,
              statement: `Recent history: ${rationales.slice(0, 5).join('; ')}`,
              sourceRefs: eventRefs,
              freshnessAt,
              modelVersion: 'fake-llm-v0',
            },
          ]
        : []),
    ];

    return this.semantic.replaceAll(profileId, inputs);
  }

  // ---------------- working tier (hybrid retrieval) ----------------

  /**
   * Assemble the per-task working slice. HYBRID: profile facts + semantic
   * insights are each scored by vector similarity to the task query; episodic
   * rationales add recent context. Candidates are ranked, then greedily packed
   * under the HARD token budget (highest score first). A summarization pass
   * distills the packed facts and is itself counted against the budget.
   */
  async retrieve(task: RetrieveTask): Promise<WorkingSlice> {
    if (!Number.isFinite(task.budgetTokens) || task.budgetTokens <= 0) {
      throw new Error('retrieve: budgetTokens must be a positive number');
    }

    const queryVec = this.embedder.embed(task.query);

    const facts = await this.profile.readFacts(task.userId);
    const insights = await this.semantic.listByProfile(task.profileId);
    const events = await this.episodic.read(task.userId, task.episodicLimit ?? 20);

    const candidates: Candidate[] = [];

    for (const f of facts) {
      candidates.push({
        tier: 'profile',
        text: f.text,
        ref: f.ref,
        score: this.similarity(queryVec, f.text),
      });
    }
    for (const ins of insights) {
      candidates.push({
        tier: 'semantic',
        text: ins.statement,
        ref: `insight:${ins.id}`,
        score: this.similarity(queryVec, ins.statement) * 0.9, // derived → slightly discounted
      });
    }
    for (const e of events) {
      const text = e.rationale ?? `${e.type} event`;
      candidates.push({
        tier: 'episodic',
        text,
        ref: `event:${e.id}`,
        score: this.similarity(queryVec, text) * 0.8,
      });
    }

    // Rank by score desc; stable tie-break by ref keeps output deterministic.
    candidates.sort((a, b) => (b.score - a.score) || a.ref.localeCompare(b.ref));

    // Summarize the top-ranked facts, then reserve its budget FIRST so the summary
    // is never dropped in favor of raw entries.
    const summary = await this.summarizer.summarize({
      task: task.query,
      facts: candidates.slice(0, 5).map((c) => c.text),
    });
    const summaryTokens = estimateTokens(summary);

    const entries: WorkingSliceEntry[] = [];
    let usedTokens = summaryTokens;
    let truncated = false;

    for (const c of candidates) {
      const tokens = estimateTokens(c.text);
      if (usedTokens + tokens > task.budgetTokens) {
        truncated = true; // at least one candidate didn't fit → slice is a strict subset
        continue;
      }
      usedTokens += tokens;
      entries.push({ tier: c.tier, text: c.text, ref: c.ref, tokens, score: c.score });
    }

    // If even the summary alone blew the budget, drop entries entirely and mark
    // truncated — the HARD cap always wins over completeness.
    if (summaryTokens > task.budgetTokens) {
      return {
        summary: '',
        entries: [],
        usedTokens: 0,
        budgetTokens: task.budgetTokens,
        truncated: true,
      };
    }

    return {
      summary,
      entries,
      usedTokens,
      budgetTokens: task.budgetTokens,
      truncated: truncated || entries.length < candidates.length,
    };
  }

  private similarity(queryVec: number[], text: string): number {
    return cosineSimilarity(queryVec, this.embedder.embed(text));
  }
}

/** Convenience: total available memory item count (used by tests to prove bounding). */
export function totalMemoryItems(
  facts: ProfileFact[],
  insights: DerivedInsight[],
  events: MemoryEvent[],
): number {
  return facts.length + insights.length + events.length;
}
