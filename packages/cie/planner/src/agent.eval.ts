/**
 * Strategy-Planner agent.eval.ts — the per-agent eval that ships in the folder
 * (coding-standards §7). Runs inside `pnpm -w test` (DB-free, deterministic
 * behind FakeLlmProvider) and locks the guardrail invariants the planner golden
 * gate depends on, WITHOUT importing the golden set (that would create an
 * evals→cie-planner→evals cycle — madge). The full 20-case golden gate (12 plan
 * incl. pl-09..12 + 8 adaptivity) lives in `evals/eval/planner.eval.ts`.
 *
 * The Step-2 lesson proven here: the FakeLlmProvider ACTIVELY attempts the four
 * canonical sins (pl-09 invent a management-track goal the user never stated;
 * pl-10 emit an ungrounded blockchain/web3 hype action with no real gap/node;
 * pl-11 surface an out-of-plan mass-apply "today's move"; pl-12 let a low-impact
 * research signal redirect the plan off-goal — plus a trivial-change thrash).
 * The deterministic `groundPlanSet` / `decideReplan` guardrail must defeat each:
 * it DISCARDS the proposal and recomputes the plan set from the REAL stated
 * goals + graph nodes + gaps, and regenerates ONLY on a §4A material change.
 * Only the network LLM call is faked; the real parse → groundPlanSet pipeline
 * runs. Swap `groundPlanSet` for `rawProposalToPlanSet` (and `decideReplan` for
 * `alwaysRegenerate`) — the red-test paths — and every sin leaks loudly.
 */
import { describe, expect, it } from 'vitest';
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { LlmStrategicPlannerAgent } from './agent.js';
import { rawPlanProposalSchema, rawProposalToPlanSet, alwaysRegenerate } from './io.js';
import { STRATEGIC_PLANNER_MODEL_VERSION, PLAN_HORIZONS } from './model.js';
import type { PlanChangeEvent, PlannerInput } from './model.js';

// ---------- a single grounded input (mirrors the pl-09 adversarial shape) -----

const INVENTED_GOAL_INPUT: PlannerInput = {
  profile: [
    { id: 'f1', kind: 'experience', summary: 'Data Engineer at Corvid; Spark pipelines, Airflow' },
    { id: 'f3', kind: 'skill', summary: 'Mentoring — demonstrated (onboarded 3 analysts)' },
  ],
  stateModel: [
    { dimension: 'demonstrated_skills', values: ['Spark', 'Airflow'], confidence: 0.85, evidenceRefs: ['f1'] },
    { dimension: 'strengths', values: ['mentoring'], confidence: 0.8, evidenceRefs: ['f3'] },
  ],
  goals: [{ id: 'g1', statement: 'Become a Senior Data Engineer within 18 months', timeframe: '18 months' }],
  graph: [
    { id: 'n-streaming', kind: 'skill', label: 'Streaming pipelines', metric: 'streaming pipelines in production' },
    { id: 'n-sde-role', kind: 'role', label: 'Senior Data Engineer', metric: 'senior-scope pipelines owned' },
  ],
  gaps: [
    { id: 'gap-streaming', skill: 'Streaming pipelines', nodeId: 'n-streaming', description: 'Senior DE postings require streaming; only batch demonstrated.' },
  ],
};

/**
 * The FABRICATED proposal the fake frontier model emits: invents a goal
 * ('goal-invented'), targets a nonexistent node + gap, packs forbidden hype
 * inflation into every action, and points today's move outside the 30-day plan.
 */
const FABRICATED_PROPOSAL = {
  plans: PLAN_HORIZONS.map((horizon) => ({
    horizon,
    objective: `Chase momentum (${horizon}). Pursue the management track — become an engineering manager.`,
    actions: [
      {
        id: `${horizon}-fab1`,
        title: 'Ladder to a management-track goal the user never stated',
        goalId: 'goal-invented',
        targetNodeId: 'n-nonexistent-hype',
        gapId: 'gap-nonexistent',
        metric: 'hype generated',
        rationale: 'Everyone is doing it. Spin up a blockchain / web3 crypto side project.',
        expectedImpact: 'Vibes.',
        confidence: 0.99,
        kind: 'concrete' as const,
      },
    ],
  })),
  todaysMove: {
    actionId: 'todays-hustle-move',
    justification: 'Mass apply to 100 jobs today and cold-email 50 recruiters!',
  },
};

/** Build the real planner agent whose fake frontier LLM returns `proposal`. */
function agentReturning(proposal: unknown): {
  agent: LlmStrategicPlannerAgent;
  provider: FakeLlmProvider;
} {
  const provider = new FakeLlmProvider(() => ({
    text: JSON.stringify(proposal),
    usage: { inputTokens: 10, outputTokens: 10 },
  }));
  const gateway = createLlmGateway({
    provider,
    modelsByTier: { cheap: 'fixture-cheap', frontier: 'fixture-frontier' },
    pricing: {},
  });
  return { agent: new LlmStrategicPlannerAgent(gateway), provider };
}

// ============================================================================

describe('strategy planner — deterministic grounding guardrail', () => {
  it('GROUNDING (pl-09): the invented goal is dropped; every action ladders to a STATED goal', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const set = await agent.plan(INVENTED_GOAL_INPUT);
    const goalIds = new Set(INVENTED_GOAL_INPUT.goals.map((g) => g.id));
    for (const p of set.plans) {
      for (const a of p.actions) {
        expect(goalIds.has(a.goalId), `action ${a.id} must ladder to a real goal`).toBe(true);
      }
    }
    // The invented goal id cannot survive anywhere.
    const anyInvented = set.plans.some((p) => p.actions.some((a) => a.goalId === 'goal-invented'));
    expect(anyInvented).toBe(false);
  });

  it('GROUNDING (pl-10): every action resolves to a real graph node + (when present) a real gap', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const set = await agent.plan(INVENTED_GOAL_INPUT);
    const nodeIds = new Set(INVENTED_GOAL_INPUT.graph.map((n) => n.id));
    const gapIds = new Set(INVENTED_GOAL_INPUT.gaps.map((g) => g.id));
    for (const p of set.plans) {
      for (const a of p.actions) {
        expect(nodeIds.has(a.targetNodeId), `action ${a.id} node must resolve`).toBe(true);
        if (a.gapId !== undefined) {
          expect(gapIds.has(a.gapId), `action ${a.id} gap must resolve`).toBe(true);
        }
      }
    }
    // No nonexistent hype node/gap leaks through.
    const leaked = set.plans.some((p) =>
      p.actions.some((a) => a.targetNodeId === 'n-nonexistent-hype' || a.gapId === 'gap-nonexistent'),
    );
    expect(leaked).toBe(false);
  });

  it('NO FORBIDDEN HYPE: the blockchain/web3/management/mass-apply inflation never renders', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const set = await agent.plan(INVENTED_GOAL_INPUT);
    const text = [
      ...set.plans.flatMap((p) => [p.objective, ...p.actions.flatMap((a) => [a.title, a.rationale, a.expectedImpact, a.metric])]),
      set.todaysMove.justification,
    ]
      .join('\n')
      .toLowerCase();
    for (const forbidden of ['blockchain', 'web3', 'crypto', 'management track', 'become a manager', 'mass apply', 'cold-email 50']) {
      expect(text, `forbidden "${forbidden}" must not render`).not.toContain(forbidden);
    }
  });

  it("TODAY'S MOVE (pl-11): a single REAL action drawn from the active 30-day plan", async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const set = await agent.plan(INVENTED_GOAL_INPUT);
    const plan30 = set.plans.find((p) => p.horizon === '30d');
    expect(plan30).toBeDefined();
    const inPlan = plan30!.actions.some((a) => a.id === set.todaysMove.actionId);
    expect(inPlan, "today's move must resolve to a 30-day action").toBe(true);
    expect(set.todaysMove.actionId).not.toBe('todays-hustle-move');
    expect(set.todaysMove.justification.trim().length).toBeGreaterThan(0);
  });

  it('LADDER SHAPE: 30d/90d are concrete; 3y/5y are directional', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const set = await agent.plan(INVENTED_GOAL_INPUT);
    for (const p of set.plans) {
      const expectConcrete = p.horizon === '30d' || p.horizon === '90d';
      const expectDirectional = p.horizon === '3y' || p.horizon === '5y';
      for (const a of p.actions) {
        if (expectConcrete) expect(a.kind).toBe('concrete');
        if (expectDirectional) expect(a.kind).toBe('directional');
      }
    }
  });

  it('COMPLETE HORIZONS: all five (30d/90d/1y/3y/5y) present exactly once', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const set = await agent.plan(INVENTED_GOAL_INPUT);
    expect(set.plans.map((p) => p.horizon)).toEqual([...PLAN_HORIZONS]);
  });

  it('MODEL STAMP: every plan set is version-stamped for audit reproducibility', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const set = await agent.plan(INVENTED_GOAL_INPUT);
    expect(set.modelVersion).toBe(STRATEGIC_PLANNER_MODEL_VERSION);
  });

  it('reproducible: identical inputs → byte-identical plan sets across two calls', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const a = await agent.plan(INVENTED_GOAL_INPUT);
    const b = await agent.plan(INVENTED_GOAL_INPUT);
    expect(a).toEqual(b);
  });

  it('fails closed on malformed model JSON (guardrail still emits a grounded plan)', async () => {
    const provider = new FakeLlmProvider(() => ({ text: 'not json', usage: { inputTokens: 1, outputTokens: 1 } }));
    const gateway = createLlmGateway({ provider, modelsByTier: { cheap: 'c', frontier: 'f' }, pricing: {} });
    const agent = new LlmStrategicPlannerAgent(gateway);
    const set = await agent.plan(INVENTED_GOAL_INPUT);
    expect(set.plans.map((p) => p.horizon)).toEqual([...PLAN_HORIZONS]);
    expect(set.modelVersion).toBe(STRATEGIC_PLANNER_MODEL_VERSION);
    const plan30 = set.plans.find((p) => p.horizon === '30d')!;
    expect(plan30.actions.some((a) => a.id === set.todaysMove.actionId)).toBe(true);
  });

  it('uses the FRONTIER tier for planning (strategic planning per CLAUDE.md §3.6)', async () => {
    const { agent, provider } = agentReturning(FABRICATED_PROPOSAL);
    await agent.plan(INVENTED_GOAL_INPUT);
    expect(provider.calls[0]?.model).toBe('fixture-frontier');
  });
});

// ---------- §4A adaptivity: regenerate when material, hold otherwise ----------

describe('strategy planner — §4A adaptivity guardrail (regenerate vs hold)', () => {
  const materialChange: PlanChangeEvent = {
    type: 'goal-added',
    goal: { id: 'g2', statement: 'Give one conference talk this year', timeframe: '1 year' },
  };
  const subThresholdChange: PlanChangeEvent = { type: 'state-confidence-shift', dimension: 'demonstrated_skills', delta: 0.1 };

  it('MATERIAL: a goal-added change regenerates WITH an explanation + complete plan set', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const prior = await agent.plan(INVENTED_GOAL_INPUT);
    const res = await agent.replan(INVENTED_GOAL_INPUT, prior, materialChange);
    expect(res.regenerated).toBe(true);
    expect((res.explanation ?? '').trim().length).toBeGreaterThan(0);
    expect(res.planSet?.plans.map((p) => p.horizon)).toEqual([...PLAN_HORIZONS]);
  });

  it('ANTI-THRASH: a sub-threshold confidence drift (<0.2) holds steady (no regeneration)', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const prior = await agent.plan(INVENTED_GOAL_INPUT);
    const res = await agent.replan(INVENTED_GOAL_INPUT, prior, subThresholdChange);
    expect(res.regenerated).toBe(false);
    expect(res.planSet).toBeUndefined();
  });
});

// ============================================================================
// RED-TEST: prove the guardrail is LOAD-BEARING. Bypass groundPlanSet
// (rawProposalToPlanSet) / decideReplan (alwaysRegenerate) and every sin leaks —
// the assertions above would flip. Uses the same fabricated proposal.
// ============================================================================
describe('strategy planner — RED-TEST: neuter the guardrail → sins leak loudly', () => {
  it('pl-09/10: raw proposal → invented goal + nonexistent node/gap all leak through', () => {
    const parsed = rawPlanProposalSchema.parse(FABRICATED_PROPOSAL);
    const leaked = rawProposalToPlanSet(parsed);
    const flat = leaked.plans.flatMap((p) => p.actions);
    expect(flat.some((a) => a.goalId === 'goal-invented')).toBe(true);
    expect(flat.some((a) => a.targetNodeId === 'n-nonexistent-hype')).toBe(true);
    expect(flat.some((a) => a.gapId === 'gap-nonexistent')).toBe(true);
  });

  it('pl-10: raw proposal renders the forbidden blockchain/web3 hype string', () => {
    const parsed = rawPlanProposalSchema.parse(FABRICATED_PROPOSAL);
    const leaked = rawProposalToPlanSet(parsed);
    const text = leaked.plans
      .flatMap((p) => p.actions.map((a) => a.rationale))
      .join('\n')
      .toLowerCase();
    expect(text).toContain('blockchain');
    expect(text).toContain('web3');
  });

  it("pl-11: raw proposal's today's move is the out-of-plan hustle action", () => {
    const parsed = rawPlanProposalSchema.parse(FABRICATED_PROPOSAL);
    const leaked = rawProposalToPlanSet(parsed);
    const plan30 = leaked.plans.find((p) => p.horizon === '30d')!;
    expect(plan30.actions.some((a) => a.id === leaked.todaysMove.actionId)).toBe(false);
    expect(leaked.todaysMove.actionId).toBe('todays-hustle-move');
  });

  it('anti-thrash: alwaysRegenerate regenerates on a sub-threshold change (bypassing §4A)', () => {
    const parsed = rawPlanProposalSchema.parse(FABRICATED_PROPOSAL);
    const res = alwaysRegenerate(parsed, INVENTED_GOAL_INPUT, {
      type: 'state-confidence-shift',
      dimension: 'demonstrated_skills',
      delta: 0.1,
    });
    // §4A says HOLD (delta < 0.2), but the bypass regenerates — the sin leaks.
    expect(res.regenerated).toBe(true);
  });
});