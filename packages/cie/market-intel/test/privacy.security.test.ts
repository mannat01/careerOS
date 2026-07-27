import { describe, expect, it } from 'vitest';
import {
  InMemoryAggregateStore,
  InMemoryContributionStore,
  MarketIntelligenceService,
  aggregate,
  type MarketAggregate,
  type OptInPort,
  type RawContribution,
} from '../src/index.js';

/**
 * M10 Step 2 — PRIVACY SECURITY SUITE (launch-blocker class).
 *
 * Each `describe` block below maps 1:1 to one of the four required security
 * tests. A failure in ANY of them is a launch blocker: it means cross-user data
 * could leak.
 */

/** A configurable opt-in port backed by an explicit allow-set. */
class SetOptInPort implements OptInPort {
  constructor(private readonly optedIn: Set<string>) {}
  hasOptedIn(userId: string): boolean {
    return this.optedIn.has(userId);
  }
  setOptedOut(userId: string): void {
    this.optedIn.delete(userId);
  }
}

function makeService(
  optedIn: Set<string>,
  minCohortSize = 3,
): {
  service: MarketIntelligenceService;
  contributions: InMemoryContributionStore;
  aggregates: InMemoryAggregateStore;
  optIn: SetOptInPort;
} {
  const optIn = new SetOptInPort(optedIn);
  const contributions = new InMemoryContributionStore();
  const aggregates = new InMemoryAggregateStore();
  const service = new MarketIntelligenceService({
    optIn,
    contributions,
    aggregates,
    config: { minCohortSize },
  });
  return { service, contributions, aggregates, optIn };
}

/** Distinct contributions for `count` opted-in users into one cohort. */
function cohortContributions(
  count: number,
  cohortKey: string,
  value: number,
): { users: string[]; contributions: RawContribution[] } {
  const users: string[] = [];
  const contributions: RawContribution[] = [];
  for (let i = 0; i < count; i += 1) {
    const userId = `user-${cohortKey}-${i}`;
    users.push(userId);
    contributions.push({
      userId,
      kind: 'tailoring_emphasis_callback',
      cohortKey,
      value,
    });
  }
  return { users, contributions };
}

describe('(a) a non-opted-in user contributes nothing', () => {
  it('drops a non-opted-in contribution: nothing is persisted', async () => {
    const { service, contributions } = makeService(new Set<string>());
    const accepted = await service.contribute({
      userId: 'not-opted-in',
      kind: 'tailoring_emphasis_callback',
      cohortKey: 'role:frontend|emphasis:impact',
      value: 1,
    });
    expect(accepted).toBe(false);
    // The raw store must be EMPTY — the signal never entered the pipeline.
    expect(await contributions.listAllContributions()).toHaveLength(0);
  });

  it('a non-opted-in user cannot appear in any rebuilt aggregate', async () => {
    // 3 opted-in + 1 not — enough opted-in to clear the k=3 threshold, so the
    // cohort survives and we can prove the non-opted-in user is absent.
    const opted = ['a', 'b', 'c'];
    const { service } = makeService(new Set(opted), 3);
    const cohortKey = 'role:frontend|emphasis:impact';
    for (const u of opted) {
      await service.contribute({ userId: u, kind: 'tailoring_emphasis_callback', cohortKey, value: 1 });
    }
    // The non-opted-in attempt is a no-op.
    await service.contribute({
      userId: 'intruder',
      kind: 'tailoring_emphasis_callback',
      cohortKey,
      value: 999,
    });
    const aggregates = await service.rebuild();
    const cohort = aggregates.find((x) => x.cohortKey === cohortKey);
    expect(cohort).toBeDefined();
    // Contributor count reflects ONLY the 3 opted-in users, not the intruder.
    expect(cohort?.contributorCount).toBe(3);
    // The intruder's outlier value (999) never skewed the mean.
    expect(cohort?.mean).toBe(1);
  });
});

describe('(b) no API path returns another user\'s identifiable data', () => {
  it('the consumption surface exposes only de-identified aggregates', async () => {
    // Distinctive userIds that can never coincidentally appear as substrings of
    // a de-identified aggregate's cohortKey/kind (so the leak assertion below is
    // meaningful and not tripped by an incidental single-letter collision).
    const opted = ['user-alpha-01', 'user-bravo-02', 'user-charlie-03'];
    const { service } = makeService(new Set(opted), 3);
    const cohortKey = 'role:backend|emphasis:scale';
    let i = 0;
    for (const u of opted) {
      await service.contribute({
        userId: u,
        kind: 'skill_demand_shift',
        cohortKey,
        value: i++,
      });
    }
    await service.rebuild();
    const published = await service.getAggregates();
    expect(published.length).toBeGreaterThan(0);
    for (const agg of published) {
      // The aggregate shape has NO field capable of carrying a userId.
      const keys = Object.keys(agg).sort();
      expect(keys).toEqual(['cohortKey', 'contributorCount', 'kind', 'mean']);
      // Belt-and-suspenders: no opted-in userId leaks through any value.
      const serialized = JSON.stringify(agg);
      for (const u of opted) expect(serialized).not.toContain(u);
    }
  });

  it('no raw contributor userId is reachable from getAggregates', async () => {
    const opted = ['alice-secret', 'bob-secret', 'carol-secret'];
    const { service } = makeService(new Set(opted), 3);
    const cohortKey = 'role:data|emphasis:ownership';
    for (const u of opted) {
      await service.contribute({ userId: u, kind: 'tailoring_emphasis_callback', cohortKey, value: 1 });
    }
    await service.rebuild();
    const serialized = JSON.stringify(await service.getAggregates());
    for (const u of opted) expect(serialized).not.toContain(u);
  });
});

describe('(c) an aggregate below the minimum cohort size is suppressed', () => {
  it('suppresses a cohort with fewer than N distinct contributors', () => {
    // 2 contributors, threshold 3 ⇒ suppressed entirely.
    const { contributions } = cohortContributions(2, 'role:tiny|emphasis:x', 1);
    const out = aggregate(contributions, { minCohortSize: 3 });
    expect(out).toHaveLength(0);
  });

  it('a single-contributor cohort is never emitted (no re-identification)', () => {
    const solo: RawContribution[] = [
      { userId: 'only-me', kind: 'tailoring_emphasis_callback', cohortKey: 'role:solo', value: 1 },
      // Same user, many rows — must NOT count as a large cohort.
      { userId: 'only-me', kind: 'tailoring_emphasis_callback', cohortKey: 'role:solo', value: 1 },
      { userId: 'only-me', kind: 'tailoring_emphasis_callback', cohortKey: 'role:solo', value: 1 },
    ];
    const out = aggregate(solo, { minCohortSize: 3 });
    expect(out).toHaveLength(0);
  });

  it('emits a cohort once it reaches the threshold, with the honest count', () => {
    const { contributions } = cohortContributions(3, 'role:ok|emphasis:y', 1);
    const out = aggregate(contributions, { minCohortSize: 3 });
    expect(out).toHaveLength(1);
    expect(out[0]?.contributorCount).toBe(3);
  });

  it('a below-threshold cohort disappears from the published set on rebuild', async () => {
    const { service } = makeService(new Set(['p', 'q']), 3);
    const cohortKey = 'role:pair|emphasis:z';
    await service.contribute({ userId: 'p', kind: 'skill_demand_shift', cohortKey, value: 1 });
    await service.contribute({ userId: 'q', kind: 'skill_demand_shift', cohortKey, value: 1 });
    const aggregates = await service.rebuild();
    expect(aggregates.find((a) => a.cohortKey === cohortKey)).toBeUndefined();
    expect(await service.getAggregates()).toHaveLength(0);
  });
});

describe('(d) opt-out purges prior contribution', () => {
  it('removes the opted-out user\'s prior contribution on the next rebuild', async () => {
    // Start with 3 opted-in users so the cohort is published.
    const opted = new Set(['x', 'y', 'z']);
    const { service, contributions, optIn } = makeService(opted, 3);
    const cohortKey = 'role:emph|emphasis:impact';
    for (const u of opted) {
      await service.contribute({ userId: u, kind: 'tailoring_emphasis_callback', cohortKey, value: 1 });
    }
    let aggregates = await service.rebuild();
    expect(aggregates.find((a) => a.cohortKey === cohortKey)?.contributorCount).toBe(3);

    // User z opts out: settings flip AND the service purges + rebuilds.
    optIn.setOptedOut('z');
    aggregates = await service.optOut('z');

    // z's raw contribution is gone from the store...
    const remaining = await contributions.listAllContributions();
    expect(remaining.some((c) => c.userId === 'z')).toBe(false);

    // ...and the cohort now falls below the threshold (2 < 3) ⇒ suppressed.
    expect(aggregates.find((a) => a.cohortKey === cohortKey)).toBeUndefined();
  });

  it('opt-out shrinks a large cohort\'s count rather than leaking the purged user', async () => {
    const opted = new Set(['m1', 'm2', 'm3', 'm4']);
    const { service, optIn } = makeService(opted, 3);
    const cohortKey = 'role:big|emphasis:scope';
    for (const u of opted) {
      await service.contribute({ userId: u, kind: 'tailoring_emphasis_callback', cohortKey, value: 1 });
    }
    let aggregates: MarketAggregate[] = await service.rebuild();
    expect(aggregates.find((a) => a.cohortKey === cohortKey)?.contributorCount).toBe(4);

    optIn.setOptedOut('m4');
    aggregates = await service.optOut('m4');

    const cohort = aggregates.find((a) => a.cohortKey === cohortKey);
    // Still above threshold (3) but the purged user no longer contributes.
    expect(cohort?.contributorCount).toBe(3);
    const serialized = JSON.stringify(aggregates);
    expect(serialized).not.toContain('m4');
  });
});