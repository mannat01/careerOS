/**
 * M07 Step 4 — Research → Plan-regeneration hook unit tests.
 *
 * These pin the two acceptance-criteria contracts:
 *   1. HIGH-impact finding constituting a §4A material change → REGENERATES
 *      the plan and returns the explained diff.
 *   2. LOW-impact finding → does NOT regenerate (anti-thrash).
 *
 * The hook delegates §4A to `isMaterialChange` from @careeros/cie-planner —
 * we import that predicate for parity assertions (single source of truth).
 */
import { describe, expect, it, vi } from 'vitest';
import { isMaterialChange } from '@careeros/cie-planner';
import {
  findingToChange,
  runResearchPlanHook,
  type PlanRegeneratorPort,
  type ResearchFindingLike,
} from '../src/scheduler/research-plan-hook.js';

const HIGH: ResearchFindingLike = {
  id: 'f-high',
  impact: 'high',
  summary: 'Company X posted 40 SRE openings in the user\u2019s market.',
};
const LOW: ResearchFindingLike = {
  id: 'f-low',
  impact: 'low',
  summary: 'Minor labeling nit in a job posting.',
};

/**
 * Helper that returns both the port and its underlying `regenerate` mock as
 * a top-level binding. Without this the `expect(port.regenerate)` pattern
 * trips @typescript-eslint/unbound-method: reading a method off an object
 * detaches `this` and could break at runtime. Capturing the mock separately
 * is safer AND clearer.
 */
function makeRegen(
  impl: () => Promise<{
    regenerated: boolean;
    diffSummary?: string;
    planId?: string;
  }>,
): { port: PlanRegeneratorPort; regenerate: ReturnType<typeof vi.fn> } {
  const regenerate = vi.fn(impl);
  return { port: { regenerate }, regenerate };
}

const okRegen = makeRegen(() =>
  Promise.resolve({
    regenerated: true,
    diffSummary: 'Added 2 near actions; deferred 1 long-horizon action.',
    planId: 'plan-new-1',
  }),
);

describe('findingToChange', () => {
  it('translates loss-lessly to a research-finding PlanChangeEvent', () => {
    expect(findingToChange(HIGH)).toEqual({
      type: 'research-finding',
      impact: 'high',
      summary: HIGH.summary,
    });
    expect(findingToChange(LOW)).toEqual({
      type: 'research-finding',
      impact: 'low',
      summary: LOW.summary,
    });
  });
  it('agrees with @careeros/cie-planner isMaterialChange (single source of truth)', () => {
    expect(isMaterialChange(findingToChange(HIGH))).toBe(true);
    expect(isMaterialChange(findingToChange(LOW))).toBe(false);
  });
});

describe('runResearchPlanHook', () => {
  it('regenerates the plan on a HIGH-impact material finding, with an explained diff', async () => {
    const results = await runResearchPlanHook('user-1', [HIGH], okRegen.port);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      findingId: 'f-high',
      material: true,
      regenerated: true,
      diffSummary: 'Added 2 near actions; deferred 1 long-horizon action.',
      planId: 'plan-new-1',
    });
    expect(okRegen.regenerate).toHaveBeenCalledTimes(1);
  });

  it('does NOT regenerate on a LOW-impact finding (anti-thrash)', async () => {
    const { port, regenerate } = makeRegen(() =>
      Promise.resolve({ regenerated: true }),
    );
    const results = await runResearchPlanHook('user-1', [LOW], port);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      findingId: 'f-low',
      material: false,
      regenerated: false,
    });
    expect(regenerate).not.toHaveBeenCalled();
  });

  it('mixes HIGH + LOW correctly (call count matches material count)', async () => {
    const { port, regenerate } = makeRegen(() =>
      Promise.resolve({ regenerated: true, planId: 'p2' }),
    );
    const results = await runResearchPlanHook('user-1', [HIGH, LOW, HIGH], port);
    expect(results.map((r) => r.material)).toEqual([true, false, true]);
    expect(results.map((r) => r.regenerated)).toEqual([true, false, true]);
    expect(regenerate).toHaveBeenCalledTimes(2);
  });

  it('never throws on regenerator error — reports as suppressedReason', async () => {
    const { port } = makeRegen(() => Promise.reject(new Error('planner-down')));
    const [only] = await runResearchPlanHook('user-1', [HIGH], port);
    expect(only?.regenerated).toBe(false);
    expect(only?.suppressedReason).toContain('regenerator_error');
    expect(only?.suppressedReason).toContain('planner-down');
  });

  it('reports declining regenerator with a suppressedReason', async () => {
    const { port } = makeRegen(() => Promise.resolve({ regenerated: false }));
    const [only] = await runResearchPlanHook('user-1', [HIGH], port);
    expect(only?.regenerated).toBe(false);
    expect(only?.suppressedReason).toBeDefined();
  });

  it('returns an empty array on empty findings (no calls to regenerator)', async () => {
    const { port, regenerate } = makeRegen(() =>
      Promise.resolve({ regenerated: true }),
    );
    const results = await runResearchPlanHook('user-1', [], port);
    expect(results).toEqual([]);
    expect(regenerate).not.toHaveBeenCalled();
  });
});