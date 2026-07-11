import { describe, it, expect } from 'vitest';
import {
  MemoryService,
  FakeEmbedder,
  FakeLlmProvider,
  InMemoryProfileReader,
  InMemoryEpisodicStore,
  InMemorySemanticStore,
  estimateTokens,
  type ProfileFact,
} from '../src/index.js';

const USER = 'user-1';
const PROFILE = 'profile-1';

/** Build a service over the DB-free in-memory tiers with a seeded profile. */
function buildService(facts: ProfileFact[]): {
  service: MemoryService;
  episodic: InMemoryEpisodicStore;
  semantic: InMemorySemanticStore;
  profile: InMemoryProfileReader;
} {
  const profile = new InMemoryProfileReader({ [USER]: facts });
  const episodic = new InMemoryEpisodicStore();
  const semantic = new InMemorySemanticStore();
  const service = new MemoryService({
    profile,
    episodic,
    semantic,
    embedder: new FakeEmbedder(),
    summarizer: new FakeLlmProvider(),
  });
  return { service, episodic, semantic, profile };
}

/** A generous set of facts so the full memory is much larger than a min-slice. */
function manyFacts(n: number): ProfileFact[] {
  const kinds = ['experience', 'project', 'education', 'skill'] as const;
  return Array.from({ length: n }, (_, i) => ({
    kind: kinds[i % kinds.length]!,
    text: `Fact ${i}: built distributed payment systems in TypeScript and Postgres at company ${i}`,
    ref: `${kinds[i % kinds.length]!}:row-${i}`,
  }));
}

describe('MemoryService.retrieve — min-slice token budget (HARD cap)', () => {
  it('returns a slice that PROVABLY never exceeds the budget', async () => {
    const facts = manyFacts(40);
    const { service } = buildService(facts);

    // Sweep several budgets; every one must be respected exactly.
    for (const budgetTokens of [20, 40, 80, 160, 320]) {
      const slice = await service.retrieve({
        userId: USER,
        profileId: PROFILE,
        query: 'payment systems in typescript',
        budgetTokens,
      });

      // Recompute the token cost independently and assert ≤ budget.
      const recomputed =
        estimateTokens(slice.summary) +
        slice.entries.reduce((acc, e) => acc + estimateTokens(e.text), 0);

      expect(slice.usedTokens).toBeLessThanOrEqual(budgetTokens);
      expect(recomputed).toBeLessThanOrEqual(budgetTokens);
      expect(slice.usedTokens).toBe(recomputed);
      expect(slice.budgetTokens).toBe(budgetTokens);
    }
  });

  it('never returns the full memory — the slice is a strict subset', async () => {
    const facts = manyFacts(40);
    const { service } = buildService(facts);

    const budgetTokens = 60; // deliberately far smaller than the full memory
    const slice = await service.retrieve({
      userId: USER,
      profileId: PROFILE,
      query: 'payment systems in typescript',
      budgetTokens,
    });

    // BOTH acceptance assertions in one place:
    //  (a) bounded by budget, and (b) strictly fewer than all available facts.
    expect(slice.usedTokens).toBeLessThanOrEqual(budgetTokens);
    expect(slice.entries.length).toBeLessThan(facts.length);
    expect(slice.truncated).toBe(true);

    // Every returned entry corresponds to a real source fact (no fabrication).
    const validRefs = new Set(facts.map((f) => f.ref));
    for (const e of slice.entries) {
      if (e.tier === 'profile') expect(validRefs.has(e.ref)).toBe(true);
    }
  });

  it('degrades to an empty, still-bounded slice when the budget is tinier than the summary', async () => {
    const { service } = buildService(manyFacts(40));
    const slice = await service.retrieve({
      userId: USER,
      profileId: PROFILE,
      query: 'payment systems',
      budgetTokens: 1,
    });
    expect(slice.usedTokens).toBeLessThanOrEqual(1);
    expect(slice.entries).toHaveLength(0);
    expect(slice.truncated).toBe(true);
  });

  it('rejects a non-positive budget (no silent default)', async () => {
    const { service } = buildService(manyFacts(4));
    await expect(
      service.retrieve({ userId: USER, profileId: PROFILE, query: 'x', budgetTokens: 0 }),
    ).rejects.toThrow(/budgetTokens/);
  });

  it('ranks task-relevant facts above irrelevant ones (hybrid vector retrieval)', async () => {
    const facts: ProfileFact[] = [
      { kind: 'skill', text: 'Expert in Rust systems programming and embedded firmware', ref: 'skill:rust' },
      { kind: 'skill', text: 'Designed GraphQL payment APIs in TypeScript on Postgres', ref: 'skill:payments' },
      { kind: 'education', text: 'Studied medieval French literature and poetry', ref: 'edu:lit' },
    ];
    const { service } = buildService(facts);
    const slice = await service.retrieve({
      userId: USER,
      profileId: PROFILE,
      query: 'typescript payment api postgres',
      budgetTokens: 400, // room for entries; ranking is what we assert
    });
    // The most task-relevant fact ranks first regardless of source order.
    expect(slice.entries[0]?.ref).toBe('skill:payments');
    const litRank = slice.entries.findIndex((e) => e.ref === 'edu:lit');
    const payRank = slice.entries.findIndex((e) => e.ref === 'skill:payments');
    expect(payRank).toBeLessThan(litRank);
  });
});

describe('MemoryService.regenerate — semantic tier is NON-AUTHORITATIVE', () => {
  it('drop+rebuild changes ZERO source facts', async () => {
    const facts = manyFacts(6);
    const { service, profile } = buildService(facts);

    const before = await profile.readFacts(USER);

    await service.regenerate(USER, PROFILE);
    const insights1 = await service.insights(PROFILE);
    expect(insights1.length).toBeGreaterThan(0);

    // Regenerate again (drop the first set, rebuild).
    await service.regenerate(USER, PROFILE);
    const insights2 = await service.insights(PROFILE);

    const after = await profile.readFacts(USER);

    // Source facts are byte-for-byte unchanged across both regenerations.
    expect(after).toEqual(before);
    // Insights are fully replaced, not appended (drop+rebuild, not accumulate).
    expect(insights2.length).toBe(insights1.length);
    const ids1 = new Set(insights1.map((i) => i.id));
    for (const i of insights2) expect(ids1.has(i.id)).toBe(false);
  });

  it('derived insights carry sourceRefs back to authoritative facts (never a source of truth)', async () => {
    const facts = manyFacts(6);
    const { service } = buildService(facts);
    await service.regenerate(USER, PROFILE);
    const [primary] = await service.insights(PROFILE);
    const factRefs = new Set(facts.map((f) => f.ref));
    expect(primary).toBeDefined();
    for (const ref of primary!.sourceRefs) expect(factRefs.has(ref)).toBe(true);
  });
});

describe('MemoryEvent (episodic) — append-only, no update/delete path', () => {
  it('append + read accumulate history; the store exposes no mutation surface', async () => {
    const { service, episodic } = buildService([]);

    await service.recordEvent({ userId: USER, type: 'system', payload: { a: 1 }, rationale: 'profile imported' });
    await service.recordEvent({ userId: USER, type: 'user_decision', payload: { b: 2 }, rationale: 'edited headline' });

    const history = await service.history(USER);
    expect(history).toHaveLength(2);
    expect(episodic.countFor(USER)).toBe(2);

    // The EpisodicStore contract has ONLY append + read — no update/delete exist.
    const surface = episodic as unknown as Record<string, unknown>;
    expect(typeof surface.append).toBe('function');
    expect(typeof surface.read).toBe('function');
    expect(surface.update).toBeUndefined();
    expect(surface.delete).toBeUndefined();
    expect(surface.remove).toBeUndefined();
  });

  it('reads are most-recent-first and honor a limit', async () => {
    const { service } = buildService([]);
    await service.recordEvent({ userId: USER, type: 'system', payload: {}, rationale: 'first' });
    await service.recordEvent({ userId: USER, type: 'system', payload: {}, rationale: 'second' });
    await service.recordEvent({ userId: USER, type: 'system', payload: {}, rationale: 'third' });

    const latest = await service.history(USER, 2);
    expect(latest.map((e) => e.rationale)).toEqual(['third', 'second']);
  });
});
