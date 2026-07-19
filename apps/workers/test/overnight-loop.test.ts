/**
 * M07 Step 4 — Overnight-loop unit tests.
 *
 * The full integration story (real Postgres + Redis) lives in apps/api. These
 * unit tests exercise the pure orchestration seams — the loop wired against
 * in-memory adapters — and pin every acceptance-criteria contract:
 *
 *   - Quiet hours: loop returns `{ suppressed: 'quiet_hours' }`, does NOT
 *     call the composer, and audits the suppression.
 *   - Idempotency: two triggers for the same (user, day) yield ONE briefing;
 *     the second call returns `{ duplicate: true, existingBriefingRunId }`.
 *   - Partial failure: composer returns `status='partial'` with a retryable
 *     step; the loop reports the composer's outcome verbatim (NOT blank).
 *   - Research → plan hook: HIGH-impact finding regenerates plan; LOW-impact
 *     finding does NOT (anti-thrash) — same trigger, one loop pass.
 *   - Budget cap (ADR-003): when the composer already spent past the cap,
 *     the loop PARKS the research→plan hook (not fails); result reflects
 *     `hookParked: true`, plan regenerator was NEVER called.
 *   - Autonomy: the loop never fires a Yellow action; composer + regenerator
 *     are the only outbound calls it makes.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryIdempotencyStore,
  runOvernightLoop,
  type AuditPort,
  type BriefingComposerPort,
  type ComposedBriefing,
  type OvernightLoopDeps,
  type OvernightLoopInput,
  type PlanRegeneratorPort,
  type ResearchFindingLike,
  type ResearchFindingReadPort,
  type UserBriefingSchedule,
} from '../src/scheduler/index.js';

// ------------- fixtures -------------

const CHICAGO: UserBriefingSchedule = {
  timezone: 'America/Chicago',
  dailyAt: '08:00',
  quietHours: { enabled: true, start: '22:00', end: '07:00' },
};

// 08:00 CDT July 19 → 13:00 UTC July 19 (outside quiet hours; eligible).
const DAYTIME = new Date(Date.UTC(2026, 6, 19, 13, 0, 0));
// 01:00 CDT July 19 → 06:00 UTC July 19 (INSIDE cross-midnight quiet window).
const NIGHTTIME = new Date(Date.UTC(2026, 6, 19, 6, 0, 0));

const HIGH_FINDING: ResearchFindingLike = {
  id: 'f-high',
  impact: 'high',
  summary: 'Major hiring surge for the user\u2019s target role.',
};
const LOW_FINDING: ResearchFindingLike = {
  id: 'f-low',
  impact: 'low',
  summary: 'Trivial market noise.',
};

// ------------- adapters -------------

function fakeComposer(overrides?: Partial<ComposedBriefing>): {
  port: BriefingComposerPort;
  calls: number;
} {
  let calls = 0;
  const port: BriefingComposerPort = {
    compose: (input) => {
      calls++;
      const base: ComposedBriefing = {
        briefingRunId: `br-${input.userId}-${input.runDayKey}`,
        status: 'complete',
        itemCount: 3,
        costUsd: 0.05,
        steps: [
          { name: 'refresh-context', status: 'ok', costUsd: 0.01, itemsProduced: 1 },
          { name: 'score-opps', status: 'ok', costUsd: 0.02, itemsProduced: 1 },
          { name: 'compose', status: 'ok', costUsd: 0.02, itemsProduced: 1 },
        ],
        ...overrides,
      };
      return Promise.resolve(base);
    },
  };
  return {
    port,
    get calls() {
      return calls;
    },
  };
}

function fakeResearch(findings: ResearchFindingLike[]): ResearchFindingReadPort {
  return {
    listRecentFindingsAffectingUser: () => Promise.resolve(findings),
  };
}

function fakeRegenerator(): {
  port: PlanRegeneratorPort;
  calls: Array<{ userId: string; changeType: string; impact?: string }>;
} {
  const calls: Array<{ userId: string; changeType: string; impact?: string }> = [];
  const port: PlanRegeneratorPort = {
    regenerate: (input) => {
      // `impact` exists only on the `research-finding` variant of the
      // discriminated union — narrow with a type-guard before recording.
      const impact =
        input.change.type === 'research-finding' ? input.change.impact : undefined;
      calls.push({
        userId: input.userId,
        changeType: input.change.type,
        ...(impact ? { impact } : {}),
      });
      return Promise.resolve({
        regenerated: true,
        diffSummary: `Diff for ${input.change.type}.`,
        planId: `plan-new-${calls.length}`,
      });
    },
  };
  return { port, calls };
}

function fakeAudit(): { port: AuditPort; entries: Array<{ action: string; reason: string; target?: string }> } {
  const entries: Array<{ action: string; reason: string; target?: string }> = [];
  const port: AuditPort = {
    append: ({ action, reason, target }) => {
      entries.push({ action, reason, ...(target ? { target } : {}) });
      return Promise.resolve();
    },
  };
  return { port, entries };
}

function baseInput(overrides?: Partial<OvernightLoopInput>): OvernightLoopInput {
  return {
    userId: 'user-1',
    subscriptionTier: 'free',
    schedule: CHICAGO,
    now: DAYTIME,
    traceId: 'trace-1',
    dailyCapUsd: 1.0,
    ...overrides,
  };
}

// ------------- tests -------------

describe('runOvernightLoop — quiet hours', () => {
  it('SUPPRESSES the run during quiet hours; composer is NEVER called', async () => {
    const composer = fakeComposer();
    const research = fakeResearch([HIGH_FINDING]);
    const regen = fakeRegenerator();
    const audit = fakeAudit();
    const deps: OvernightLoopDeps = {
      composer: composer.port,
      research,
      planRegenerator: regen.port,
      idempotency: new InMemoryIdempotencyStore(),
      audit: audit.port,
    };

    const result = await runOvernightLoop(baseInput({ now: NIGHTTIME }), deps);

    expect(result.kind).toBe('suppressed');
    if (result.kind === 'suppressed') expect(result.reason).toBe('quiet_hours');
    expect(composer.calls).toBe(0);
    expect(regen.calls).toHaveLength(0);
    expect(audit.entries.some((e) => e.action === 'scheduler.overnight_loop.suppressed')).toBe(true);
  });
});

describe('runOvernightLoop — idempotency (per user, day)', () => {
  it('two triggers for the same (user, day) compose ONE briefing', async () => {
    const composer = fakeComposer();
    const research = fakeResearch([LOW_FINDING]);
    const regen = fakeRegenerator();
    const audit = fakeAudit();
    const idempotency = new InMemoryIdempotencyStore();
    const deps: OvernightLoopDeps = {
      composer: composer.port,
      research,
      planRegenerator: regen.port,
      idempotency,
      audit: audit.port,
    };

    const first = await runOvernightLoop(baseInput(), deps);
    const second = await runOvernightLoop(baseInput(), deps);

    expect(first.kind).toBe('composed');
    expect(second.kind).toBe('duplicate');
    expect(composer.calls).toBe(1); // NOT two
    if (first.kind === 'composed' && second.kind === 'duplicate') {
      expect(second.existingBriefingRunId).toBe(first.briefing.briefingRunId);
      expect(second.runDayKey).toBe(first.runDayKey);
    }
    expect(audit.entries.some((e) => e.action === 'scheduler.overnight_loop.duplicate')).toBe(true);
  });

  it('same user, DIFFERENT local day → composes a second briefing', async () => {
    const composer = fakeComposer();
    const deps: OvernightLoopDeps = {
      composer: composer.port,
      research: fakeResearch([]),
      planRegenerator: fakeRegenerator().port,
      idempotency: new InMemoryIdempotencyStore(),
      audit: fakeAudit().port,
    };

    await runOvernightLoop(baseInput(), deps);
    // 24 hours later, same wall-clock 08:00 CDT.
    const nextDay = new Date(DAYTIME.getTime() + 24 * 60 * 60 * 1000);
    const res2 = await runOvernightLoop(baseInput({ now: nextDay }), deps);

    expect(composer.calls).toBe(2);
    expect(res2.kind).toBe('composed');
  });
});

describe('runOvernightLoop — partial failure (never blank)', () => {
  it('surfaces a PARTIAL briefing with retryable flags when composer degrades', async () => {
    const composer = fakeComposer({
      status: 'partial',
      itemCount: 2,
      costUsd: 0.03,
      steps: [
        { name: 'refresh-context', status: 'ok', costUsd: 0.01, itemsProduced: 1 },
        {
          name: 'research-refresh',
          status: 'failed',
          costUsd: 0,
          itemsProduced: 0,
          error: 'source X 500',
          retryable: true,
        },
        { name: 'compose', status: 'ok', costUsd: 0.02, itemsProduced: 1 },
      ],
    });
    const audit = fakeAudit();
    const deps: OvernightLoopDeps = {
      composer: composer.port,
      research: fakeResearch([]),
      planRegenerator: fakeRegenerator().port,
      idempotency: new InMemoryIdempotencyStore(),
      audit: audit.port,
    };

    const res = await runOvernightLoop(baseInput(), deps);
    expect(res.kind).toBe('composed');
    if (res.kind === 'composed') {
      expect(res.briefing.status).toBe('partial'); // NOT 'failed', NOT blank
      expect(res.briefing.itemCount).toBeGreaterThan(0);
      const failedStep = res.briefing.steps.find((s) => s.status === 'failed');
      expect(failedStep?.retryable).toBe(true);
    }
    expect(audit.entries.some((e) => e.reason.includes('status=partial'))).toBe(true);
  });
});

describe('runOvernightLoop — research → plan hook', () => {
  it('HIGH-impact finding triggers plan regeneration with a diff', async () => {
    const composer = fakeComposer();
    const research = fakeResearch([HIGH_FINDING]);
    const regen = fakeRegenerator();
    const deps: OvernightLoopDeps = {
      composer: composer.port,
      research,
      planRegenerator: regen.port,
      idempotency: new InMemoryIdempotencyStore(),
      audit: fakeAudit().port,
    };

    const res = await runOvernightLoop(baseInput(), deps);
    expect(res.kind).toBe('composed');
    if (res.kind === 'composed') {
      expect(res.research).toHaveLength(1);
      const [only] = res.research;
      expect(only?.material).toBe(true);
      expect(only?.regenerated).toBe(true);
      expect(only?.diffSummary).toBeTruthy();
      expect(only?.planId).toBe('plan-new-1');
    }
    expect(regen.calls).toHaveLength(1);
    expect(regen.calls[0]?.impact).toBe('high');
  });

  it('LOW-impact finding does NOT trigger plan regeneration (anti-thrash)', async () => {
    const composer = fakeComposer();
    const research = fakeResearch([LOW_FINDING]);
    const regen = fakeRegenerator();
    const deps: OvernightLoopDeps = {
      composer: composer.port,
      research,
      planRegenerator: regen.port,
      idempotency: new InMemoryIdempotencyStore(),
      audit: fakeAudit().port,
    };

    const res = await runOvernightLoop(baseInput(), deps);
    expect(res.kind).toBe('composed');
    if (res.kind === 'composed') {
      expect(res.research).toHaveLength(1);
      const [only] = res.research;
      expect(only?.material).toBe(false);
      expect(only?.regenerated).toBe(false);
    }
    expect(regen.calls).toHaveLength(0);
  });
});

describe('runOvernightLoop — budget cap (ADR-003)', () => {
  it('PARKS the research→plan hook when the cap is exhausted; regenerator NOT called', async () => {
    // Composer already spent past the tiny cap → hook must park.
    const composer = fakeComposer({
      status: 'complete',
      costUsd: 0.49,
      itemCount: 3,
      steps: [
        { name: 'compose', status: 'ok', costUsd: 0.49, itemsProduced: 3 },
      ],
    });
    const research = fakeResearch([HIGH_FINDING]);
    const regen = fakeRegenerator();
    const audit = fakeAudit();
    const deps: OvernightLoopDeps = {
      composer: composer.port,
      research,
      planRegenerator: regen.port,
      idempotency: new InMemoryIdempotencyStore(),
      audit: audit.port,
    };

    const res = await runOvernightLoop(
      baseInput({
        dailyCapUsd: 0.5,
        // Estimate exceeds the remaining 0.01 headroom.
        costEstimatePerFindingUsd: 0.05,
      }),
      deps,
    );

    expect(res.kind).toBe('composed');
    if (res.kind === 'composed') {
      expect(res.budget.hookParked).toBe(true);
      expect(res.budget.capUsd).toBe(0.5);
      expect(res.research).toEqual([]); // hook never ran
    }
    expect(regen.calls).toHaveLength(0); // graceful degradation
    // Loop did NOT fail: composer + briefing outcome preserved.
    if (res.kind === 'composed') expect(res.briefing.status).toBe('complete');
    expect(audit.entries.some((e) => e.action === 'scheduler.overnight_loop.budget_exhausted')).toBe(true);
  });
});

describe('runOvernightLoop — autonomy', () => {
  it('never invokes any outbound action beyond composer + regenerator (only PREPARES)', async () => {
    const composer = fakeComposer();
    const research = fakeResearch([HIGH_FINDING]);
    const regen = fakeRegenerator();
    const audit = fakeAudit();
    // Sentinel to catch any mystery outbound: the loop only touches deps we
    // gave it. Attach a spied audit + composer to ensure no extra activity
    // fires (e.g. no fake "yellow action" side effect).
    const composeSpy = vi.spyOn(composer.port, 'compose');
    const regenSpy = vi.spyOn(regen.port, 'regenerate');
    const deps: OvernightLoopDeps = {
      composer: composer.port,
      research,
      planRegenerator: regen.port,
      idempotency: new InMemoryIdempotencyStore(),
      audit: audit.port,
    };

    await runOvernightLoop(baseInput(), deps);

    expect(composeSpy).toHaveBeenCalledTimes(1);
    expect(regenSpy).toHaveBeenCalledTimes(1);
    // No item ever gets an approval/execute call — those live in Step 5's
    // approval queue. The loop only PREPARES. As a proxy, no audit row
    // mentions any autonomy-tier action.
    expect(
      audit.entries.some((e) => /approval|yellow|execute|autonomy/i.test(e.action)),
    ).toBe(false);
  });
});