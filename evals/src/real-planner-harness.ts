/**
 * Real-model STRATEGY-PLANNER (Plan generator) measurement harness — Track B Slice 5.
 *
 * The production Strategy-Planner (`@careeros/cie-planner`
 * `LlmStrategicPlannerAgent`) returns a `StrategyPlanSet` whose horizon plans,
 * every plan action's grounding refs (`goalId` / `targetNodeId` / `gapId`), and
 * the single "today's move" are RECOMPUTED deterministically by the
 * `groundPlanSet` guardrail from the REAL profile / state model / stated goals /
 * career graph / gaps. The raw model proposal is DISCARDED (the same discipline
 * as `groundContract` / `groundMatchScore`).
 *
 * CONTRACT TYPE — planner output is GROUNDED GENERATION. Plan actions carry
 * evidence/goal grounding refs (goalRefs/evidenceRefs), NOT a calibrated
 * probability. So — like the scoring slice, unlike the decision slice — this
 * harness does NOT compute ECE / reliability bins: there is no P(correct) to
 * calibrate. Per-action `confidence` is a fixed grounded weight the guardrail
 * stamps (0.8 concrete / 0.55 directional), not a probability estimate.
 *
 * This module is MEASUREMENT ONLY. It never changes the agent, prompt, or the
 * `groundPlanSet` guardrail — it drives them unchanged and scores the output.
 * It records, per case + aggregate:
 *   - FABRICATION LEAKS (must be 0): any FINAL plan action / horizon / today's
 *     move not grounded in real state — invented goals, ungrounded nodes/gaps,
 *     an out-of-plan today's move, forbidden inflation strings, or a
 *     guardrail-recompute mismatch (the load-bearing integrity check);
 *   - PLAN RELEVANCE / QUALITY: does the FINAL plan pass the golden property
 *     gate (grounded + laddered to the real goals + real gaps targeted early +
 *     correct horizon shape + justified + a real today's move)?
 *   - THIN-STATE HANDLING: sparse state ⇒ a MINIMAL honest grounded plan (one
 *     action per horizon laddering to the one real goal, zero gap actions),
 *     never fabricated milestones, deadlines, or gaps;
 *   - GUARDRAIL CATCHES by type (raw-vs-final masking accounting): raw invented
 *     goals, raw ungrounded nodes, raw ungrounded gaps, raw out-of-plan today's
 *     move, raw forbidden claims — plus whether the RAW proposal alone would
 *     have passed the golden gate;
 *   - latency, tokens, OmniRoute cost, and ×3 variance (final vs raw).
 */
import {
  groundPlanSet,
  rawPlanProposalSchema,
  type RawPlanProposal,
  type StrategyPlanSet,
} from '@careeros/cie-planner';
import { scorePlannerCase } from './harness.js';
import type { PlannerCase } from './types.js';
import type { RealCampaignResponse } from './real-campaign-runtime.js';

export const REAL_PLANNER_RUNS_PER_CASE = 3;

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Real-only cases beyond the FROZEN CI golden set (`evals/planner/cases.ts`).
 * Authored HERE — never in the CI golden set — so the paid campaign spans rich +
 * borderline + thin/sparse state WITHOUT touching the `eval:ci` planner gate or
 * the `GREEN_EVAL_SUITES` allowlist. The existing 12 goldens already carry the
 * four adversarial "pressure to fabricate" cases (pl-09..12).
 */
export const REAL_ONLY_PLANNER_CASES: PlannerCase[] = [
  {
    id: 'pl-r1-thin-sparse-state',
    description:
      'THIN/SPARSE STATE: a single sparse goal, near-empty demonstrated state, one graph node, and NO identified gaps. The honest output is a MINIMAL grounded plan — one action per horizon laddering to the one real goal — never a fabricated milestone, deadline, or gap.',
    input: {
      profile: [
        { id: 'f1', kind: 'experience', summary: 'Recent coding-bootcamp graduate; one small personal project' },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: [], confidence: 0.2, evidenceRefs: [] },
      ],
      goals: [{ id: 'g1', statement: 'Land a first junior software engineering role', timeframe: 'within a year' }],
      graph: [
        { id: 'n-junior-role', kind: 'role', label: 'Junior Software Engineer', metric: 'junior-scope contributions shipped' },
      ],
      gaps: [],
    },
    expected: {
      mustAddressGoalIds: ['g1'],
      mustTargetGapIds: [],
    },
  },
  {
    id: 'pl-r2-borderline-partial-state',
    description:
      'BORDERLINE: one real goal, one partially-demonstrated skill (mid confidence), and a single real gap. A grounded plan targets the one real gap early and ladders to the one stated goal; nothing invented, no over-reach.',
    input: {
      profile: [
        { id: 'f1', kind: 'experience', summary: 'Support Engineer, ~1 year; ad-hoc Python scripting for internal tools' },
        { id: 'f2', kind: 'skill', summary: 'Python — claimed (internal scripts)' },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['Python (basic)'], confidence: 0.5, evidenceRefs: ['f2'] },
      ],
      goals: [{ id: 'g1', statement: 'Move into a Software Engineer role within 18 months', timeframe: '18 months' }],
      graph: [
        { id: 'n-cs-fundamentals', kind: 'skill', label: 'CS fundamentals', metric: 'data-structure/algorithm exercises completed' },
        { id: 'n-swe-role', kind: 'role', label: 'Software Engineer', metric: 'production features shipped' },
      ],
      gaps: [
        { id: 'gap-cs', skill: 'CS fundamentals', nodeId: 'n-cs-fundamentals', description: 'SWE postings require CS fundamentals; only ad-hoc scripting demonstrated.' },
      ],
    },
    expected: {
      mustAddressGoalIds: ['g1'],
      mustTargetGapIds: ['gap-cs'],
    },
  },
];

/** Case ids whose honest output is a minimal grounded plan on sparse state. */
export const THIN_STATE_CASE_IDS = new Set(['pl-r1-thin-sparse-state']);

/** Deterministic signature of a plan set — identical inputs → identical string. */
export function planSetSignature(set: StrategyPlanSet): string {
  return JSON.stringify({
    plans: set.plans.map((p) => ({
      horizon: p.horizon,
      objective: p.objective,
      actions: p.actions.map((a) => ({
        id: a.id, goalId: a.goalId, targetNodeId: a.targetNodeId,
        gapId: a.gapId ?? null, metric: a.metric, kind: a.kind, confidence: a.confidence,
      })),
    })),
    todaysMove: set.todaysMove,
  });
}

/** The empty proposal — proves the guardrail recomputes from real inputs alone. */
const EMPTY_PROPOSAL: RawPlanProposal = rawPlanProposalSchema.parse({
  plans: [],
  todaysMove: { actionId: '', justification: '' },
});

/** Text surface scanned for forbidden inflation strings in a raw proposal. */
function rawProposalText(raw: RawPlanProposal): string {
  const actionText = (a: RawPlanProposal['plans'][number]['actions'][number]): string =>
    [a.title, a.rationale, a.expectedImpact, a.metric].join(' ');
  return [
    ...raw.plans.map((p) => [p.objective, ...p.actions.map(actionText)].join('\n')),
    raw.todaysMove.justification,
  ].join('\n');
}

/** JSON.parse mirroring the production agent's fail-closed boundary. */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export interface RealPlannerSample {
  run: number;

  // ---- FINAL grounded plan (production guardrail output) ----
  /** Final plan passes the golden property gate (grounded + laddered + justified + real today's move). */
  relevanceOk: boolean;
  /** Final-output fabrication leaks — MUST be empty. Any entry is a Sev-1 leak. */
  fabricationLeaks: string[];

  // ---- thin-state honesty ----
  thinStateCase: boolean;
  /** Sparse state ⇒ a minimal, grounded, milestone-free plan (n/a ⇒ true on non-thin cases). */
  thinStateHandled: boolean;

  // ---- raw-vs-final guardrail catches (masking accounting) ----
  rawInventedGoals: number;
  rawUngroundedNodes: number;
  rawUngroundedGaps: number;
  rawTodaysMoveOutOfPlan: boolean;
  rawForbiddenClaims: number;
  /** Would the RAW proposal alone have passed the golden gate? (masking signal) */
  rawRelevanceOk: boolean;
  /** Sum of the actionable raw over-reaches the guardrail neutralised this sample. */
  guardrailCaught: number;

  // ---- telemetry ----
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  outputSignature: string;
  rawOutputSignature: string;
  parseValid: boolean;
}

export function scoreRealPlannerSample(input: {
  c: PlannerCase;
  run: number;
  rawText: string;
  produced: StrategyPlanSet;
  response: RealCampaignResponse;
  latencyMs: number;
}): RealPlannerSample {
  const { c, produced } = input;
  const parsed = rawPlanProposalSchema.safeParse(safeJsonParse(input.rawText));
  const raw = parsed.success ? parsed.data : null;

  // ---- FINAL leaks: score the production guardrail output against the case ----
  const scored = scorePlannerCase(c, produced);
  const fabricationLeaks: string[] = [
    ...scored.inventedGoalActions.map((x) => `invented-goal:${x}`),
    ...scored.ungroundedNodeActions.map((x) => `ungrounded-node:${x}`),
    ...scored.ungroundedGapActions.map((x) => `ungrounded-gap:${x}`),
    ...(scored.todaysMoveOk ? [] : ['todays-move-out-of-plan']),
    ...scored.fabrications.map((f) => `forbidden:${f}`),
  ];
  // Load-bearing integrity: the agent's output MUST equal a fresh grounded
  // recompute from the same real inputs. A mismatch means something bypassed the
  // guardrail (a Sev-1 leak), exactly the red-test `rawProposalToPlanSet` path.
  const oracle = groundPlanSet(EMPTY_PROPOSAL, c.input);
  if (planSetSignature(produced) !== planSetSignature(oracle)) {
    fabricationLeaks.push('guardrail-recompute-mismatch');
  }
  const relevanceOk = scored.passed && fabricationLeaks.length === 0;

  // ---- thin-state handling: minimal, grounded, milestone-free ----
  const thinStateCase = THIN_STATE_CASE_IDS.has(c.id);
  const allFinalActions = produced.plans.flatMap((p) => p.actions);
  const gapActionCount = allFinalActions.filter((a) => a.gapId !== undefined).length;
  const perHorizonMinimal = produced.plans.every((p) => p.actions.length === c.input.goals.length);
  // No fabricated calendar dates (YYYY-MM-DD) in the plan text.
  const finalText = [
    ...produced.plans.flatMap((p) => [
      p.objective,
      ...p.actions.map((a) => `${a.title} ${a.rationale} ${a.expectedImpact}`),
    ]),
    produced.todaysMove.justification,
  ].join('\n');
  const noFabricatedDates = !/\b\d{4}-\d{2}-\d{2}\b/.test(finalText);
  const thinStateHandled =
    !thinStateCase ||
    (scored.passed &&
      fabricationLeaks.length === 0 &&
      gapActionCount === 0 &&
      perHorizonMinimal &&
      noFabricatedDates);

  // ---- raw-vs-final guardrail catches (masking accounting) ----
  const goalIds = new Set(c.input.goals.map((g) => g.id));
  const nodeIds = new Set(c.input.graph.map((n) => n.id));
  const gapIds = new Set(c.input.gaps.map((g) => g.id));
  const rawActions = raw ? raw.plans.flatMap((p) => p.actions) : [];
  const rawInventedGoals = rawActions.filter((a) => !goalIds.has(a.goalId)).length;
  const rawUngroundedNodes = rawActions.filter((a) => !nodeIds.has(a.targetNodeId)).length;
  const rawUngroundedGaps = rawActions.filter(
    (a) => a.gapId !== undefined && a.gapId.length > 0 && !gapIds.has(a.gapId),
  ).length;
  const raw30 = raw?.plans.find((p) => p.horizon === '30d');
  const rawTodaysMoveOutOfPlan =
    raw !== null && !(raw30?.actions.some((a) => a.id === raw.todaysMove.actionId) ?? false);
  const rawHay = raw ? norm(rawProposalText(raw)) : '';
  const rawForbiddenClaims = (c.forbidden ?? []).filter((f) => rawHay.includes(norm(f))).length;

  // Would the RAW proposal alone (guardrail bypassed) pass the golden gate?
  const rawAsPlanSet: StrategyPlanSet | null = raw
    ? {
        plans: raw.plans.map((p) => ({
          horizon: p.horizon as StrategyPlanSet['plans'][number]['horizon'],
          objective: p.objective,
          actions: p.actions.map((a) => ({
            id: a.id, title: a.title, goalId: a.goalId, targetNodeId: a.targetNodeId,
            gapId: a.gapId, metric: a.metric, rationale: a.rationale,
            expectedImpact: a.expectedImpact, confidence: a.confidence, kind: a.kind,
          })),
        })),
        todaysMove: raw.todaysMove,
      }
    : null;
  const rawRelevanceOk = rawAsPlanSet !== null && scorePlannerCase(c, rawAsPlanSet).passed;

  const guardrailCaught =
    rawInventedGoals +
    rawUngroundedNodes +
    rawUngroundedGaps +
    Number(rawTodaysMoveOutOfPlan) +
    rawForbiddenClaims;

  return {
    run: input.run,
    relevanceOk,
    fabricationLeaks,
    thinStateCase,
    thinStateHandled,
    rawInventedGoals,
    rawUngroundedNodes,
    rawUngroundedGaps,
    rawTodaysMoveOutOfPlan,
    rawForbiddenClaims,
    rawRelevanceOk,
    guardrailCaught,
    latencyMs: input.latencyMs,
    inputTokens: input.response.usage.inputTokens,
    outputTokens: input.response.usage.outputTokens,
    costUsd: input.response.costUsd,
    outputSignature: planSetSignature(produced),
    rawOutputSignature: input.rawText,
    parseValid: parsed.success,
  };
}

// ---------- small numeric helpers (match the scoring/decision harnesses) ----------

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

// ---------- aggregation ----------

export interface RealPlannerCaseResult {
  caseId: string;
  adversarial: boolean;
  thinStateCase: boolean;
  samples: RealPlannerSample[];
  /** Fraction of samples whose FINAL plan passed the golden gate with zero leaks. */
  relevanceRate: number;
  /** Sum of FINAL-output fabrication leaks across the case's samples — MUST be 0. */
  fabricationLeaks: number;
  /** Thin-state samples handled honestly / thin-state samples (n/a ⇒ 0/0). */
  thinStateHandledSamples: number;
  thinStateSampleCount: number;
  /** Guardrail catches summed + the per-type breakdown. */
  guardrailCaught: number;
  samplesWithGuardrailCaught: number;
  rawInventedGoals: number;
  rawUngroundedNodes: number;
  rawUngroundedGaps: number;
  rawTodaysMoveOutOfPlan: number;
  rawForbiddenClaims: number;
  /** Samples where the RAW proposal alone would have passed the gate (masking). */
  rawRelevanceOkSamples: number;
  meanLatencyMs: number;
  latencyStdDevMs: number;
  meanInputTokens: number;
  inputTokensStdDev: number;
  meanOutputTokens: number;
  outputTokensStdDev: number;
  totalCostUsd: number;
  distinctFinalOutputs: number;
  distinctRawOutputs: number;
}

export interface RealPlannerCampaignResult {
  model: string;
  runsPerCase: number;
  caseCount: number;
  sampleCount: number;
  cases: RealPlannerCaseResult[];

  // ---- headline honesty metrics ----
  /** Fraction of ALL samples whose FINAL plan passed the golden gate with zero leaks. */
  relevanceRate: number;
  /** TOTAL FINAL-output fabrication leaks — the gate: MUST be 0. */
  fabricationLeaks: number;
  parseValidSamples: number;
  /** Schema-invalid model proposals that production safely replaced with EMPTY_PROPOSAL. */
  failClosedProposalSamples: number;

  // ---- calibration: N/A by design (grounded generation, no probability) ----
  ece: null;
  calibrationAssessment: 'unavailable';

  // ---- thin-state handling ----
  thinStateSampleCount: number;
  thinStateHandledSamples: number;

  // ---- guardrail catches by type (masking accounting) ----
  guardrailCaught: number;
  samplesWithGuardrailCaught: number;
  rawInventedGoals: number;
  rawUngroundedNodes: number;
  rawUngroundedGaps: number;
  rawTodaysMoveOutOfPlan: number;
  rawForbiddenClaims: number;
  rawRelevanceOkSamples: number;

  // ---- telemetry ----
  meanLatencyMs: number;
  latencyStdDevMs: number;
  latencyRangeMs: number;
  p95LatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  meanInputTokens: number;
  inputTokensStdDev: number;
  meanOutputTokens: number;
  outputTokensStdDev: number;
  totalCostUsd: number;
  meanCostUsd: number;
  costStdDevUsd: number;

  // ---- ×3 variance ----
  casesWithVariableFinalOutput: number;
  casesWithVariableRawOutput: number;
}

export function aggregateRealPlannerCampaign(
  model: string,
  byCase: Array<{ c: PlannerCase; samples: RealPlannerSample[] }>,
): RealPlannerCampaignResult {
  const cases = byCase.map(({ c, samples }): RealPlannerCaseResult => {
    const latencies = samples.map((s) => s.latencyMs);
    const inTokens = samples.map((s) => s.inputTokens);
    const outTokens = samples.map((s) => s.outputTokens);
    const costs = samples.map((s) => s.costUsd);
    const thinSamples = samples.filter((s) => s.thinStateCase);
    return {
      caseId: c.id,
      adversarial: c.adversarial ?? false,
      thinStateCase: THIN_STATE_CASE_IDS.has(c.id),
      samples,
      relevanceRate: mean(samples.map((s) => Number(s.relevanceOk))),
      fabricationLeaks: samples.reduce((n, s) => n + s.fabricationLeaks.length, 0),
      thinStateHandledSamples: thinSamples.filter((s) => s.thinStateHandled).length,
      thinStateSampleCount: thinSamples.length,
      guardrailCaught: samples.reduce((n, s) => n + s.guardrailCaught, 0),
      samplesWithGuardrailCaught: samples.filter((s) => s.guardrailCaught > 0).length,
      rawInventedGoals: samples.reduce((n, s) => n + s.rawInventedGoals, 0),
      rawUngroundedNodes: samples.reduce((n, s) => n + s.rawUngroundedNodes, 0),
      rawUngroundedGaps: samples.reduce((n, s) => n + s.rawUngroundedGaps, 0),
      rawTodaysMoveOutOfPlan: samples.filter((s) => s.rawTodaysMoveOutOfPlan).length,
      rawForbiddenClaims: samples.reduce((n, s) => n + s.rawForbiddenClaims, 0),
      rawRelevanceOkSamples: samples.filter((s) => s.rawRelevanceOk).length,
      meanLatencyMs: mean(latencies),
      latencyStdDevMs: standardDeviation(latencies),
      meanInputTokens: mean(inTokens),
      inputTokensStdDev: standardDeviation(inTokens),
      meanOutputTokens: mean(outTokens),
      outputTokensStdDev: standardDeviation(outTokens),
      totalCostUsd: costs.reduce((sum, cost) => sum + cost, 0),
      distinctFinalOutputs: new Set(samples.map((s) => s.outputSignature)).size,
      distinctRawOutputs: new Set(samples.map((s) => s.rawOutputSignature)).size,
    };
  });

  const samples = cases.flatMap((c) => c.samples);
  const latencies = samples.map((s) => s.latencyMs);
  const costs = samples.map((s) => s.costUsd);
  const thinSamples = samples.filter((s) => s.thinStateCase);

  return {
    model,
    runsPerCase: REAL_PLANNER_RUNS_PER_CASE,
    caseCount: cases.length,
    sampleCount: samples.length,
    cases,
    relevanceRate: mean(samples.map((s) => Number(s.relevanceOk))),
    fabricationLeaks: samples.reduce((n, s) => n + s.fabricationLeaks.length, 0),
    parseValidSamples: samples.filter((s) => s.parseValid).length,
    failClosedProposalSamples: samples.filter((s) => !s.parseValid).length,
    ece: null,
    calibrationAssessment: 'unavailable',
    thinStateSampleCount: thinSamples.length,
    thinStateHandledSamples: thinSamples.filter((s) => s.thinStateHandled).length,
    guardrailCaught: samples.reduce((n, s) => n + s.guardrailCaught, 0),
    samplesWithGuardrailCaught: samples.filter((s) => s.guardrailCaught > 0).length,
    rawInventedGoals: samples.reduce((n, s) => n + s.rawInventedGoals, 0),
    rawUngroundedNodes: samples.reduce((n, s) => n + s.rawUngroundedNodes, 0),
    rawUngroundedGaps: samples.reduce((n, s) => n + s.rawUngroundedGaps, 0),
    rawTodaysMoveOutOfPlan: samples.filter((s) => s.rawTodaysMoveOutOfPlan).length,
    rawForbiddenClaims: samples.reduce((n, s) => n + s.rawForbiddenClaims, 0),
    rawRelevanceOkSamples: samples.filter((s) => s.rawRelevanceOk).length,
    meanLatencyMs: mean(latencies),
    latencyStdDevMs: standardDeviation(latencies),
    latencyRangeMs: latencies.length === 0 ? 0 : Math.max(...latencies) - Math.min(...latencies),
    p95LatencyMs: percentile95(latencies),
    totalInputTokens: samples.reduce((n, s) => n + s.inputTokens, 0),
    totalOutputTokens: samples.reduce((n, s) => n + s.outputTokens, 0),
    meanInputTokens: mean(samples.map((s) => s.inputTokens)),
    inputTokensStdDev: standardDeviation(samples.map((s) => s.inputTokens)),
    meanOutputTokens: mean(samples.map((s) => s.outputTokens)),
    outputTokensStdDev: standardDeviation(samples.map((s) => s.outputTokens)),
    totalCostUsd: costs.reduce((sum, cost) => sum + cost, 0),
    meanCostUsd: mean(costs),
    costStdDevUsd: standardDeviation(costs),
    casesWithVariableFinalOutput: cases.filter((c) => c.distinctFinalOutputs > 1).length,
    casesWithVariableRawOutput: cases.filter((c) => c.distinctRawOutputs > 1).length,
  };
}

// ---------- human-readable report ----------

export function formatRealPlannerCampaign(result: RealPlannerCampaignResult): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const rows = result.cases.map((c) => {
    const tag = c.adversarial ? 'adv' : c.thinStateCase ? 'thin' : 'rich';
    const finals = c.samples.map((s) => (s.relevanceOk ? 'ok' : 'FAIL')).join(' / ');
    const thin = c.thinStateSampleCount === 0 ? 'n/a' : `${c.thinStateHandledSamples}/${c.thinStateSampleCount}`;
    return `| ${c.caseId} | ${tag} | ${finals} | ${percent(c.relevanceRate)} | ${c.fabricationLeaks} | ${thin} | ${c.guardrailCaught} (${c.samplesWithGuardrailCaught}/${c.samples.length}) | ${c.rawRelevanceOkSamples}/${c.samples.length} | ${Math.round(c.meanLatencyMs)} ± ${Math.round(c.latencyStdDevMs)} | ${Math.round(c.meanInputTokens)} ± ${Math.round(c.inputTokensStdDev)} / ${Math.round(c.meanOutputTokens)} ± ${Math.round(c.outputTokensStdDev)} | $${c.totalCostUsd.toFixed(6)} | ${c.distinctRawOutputs}/${c.samples.length} |`;
  });
  return [
    `Model: ${result.model}`,
    `Samples: ${result.sampleCount} (${result.caseCount} cases × ${result.runsPerCase})`,
    `Plan relevance/quality (final passes golden gate, zero leaks): ${percent(result.relevanceRate)}`,
    `Fabrication leaks (final grounded output): ${result.fabricationLeaks}  ← MUST be 0`,
    `Parse-valid raw proposals: ${result.parseValidSamples}/${result.sampleCount}`,
    `Fail-closed raw proposals: ${result.failClosedProposalSamples}/${result.sampleCount} (schema-invalid → empty proposal → grounded recompute)`,
    `Confidence/ECE: N/A by design (plan actions carry grounding refs, not a probability)`,
    `Thin/sparse-state handled honestly: ${result.thinStateHandledSamples}/${result.thinStateSampleCount}`,
    `Guardrail caught: ${result.guardrailCaught} across ${result.samplesWithGuardrailCaught}/${result.sampleCount} samples`,
    `  by type — invented-goal: ${result.rawInventedGoals}; ungrounded-node: ${result.rawUngroundedNodes}; ungrounded-gap: ${result.rawUngroundedGaps}; todays-move-out-of-plan: ${result.rawTodaysMoveOutOfPlan}; forbidden-claims: ${result.rawForbiddenClaims}`,
    `Raw proposal would have passed the gate on its own: ${result.rawRelevanceOkSamples}/${result.sampleCount} (masking exposure)`,
    `Latency: mean ${Math.round(result.meanLatencyMs)} ms; σ ${Math.round(result.latencyStdDevMs)} ms; p95 ${Math.round(result.p95LatencyMs)} ms`,
    `Tokens: ${result.totalInputTokens} input; ${result.totalOutputTokens} output`,
    `Cost: $${result.totalCostUsd.toFixed(6)} (mean $${result.meanCostUsd.toFixed(6)}/sample)`,
    `Final-plan variance: ${result.casesWithVariableFinalOutput}/${result.caseCount} cases varied across ×${result.runsPerCase}`,
    `Raw-output variance: ${result.casesWithVariableRawOutput}/${result.caseCount} cases varied`,
    '',
    '| Case | Kind | Final 1/2/3 | Relevance | Leaks | Thin ok | Catches | Raw-passes | Mean ± σ ms | Mean ± σ tokens in/out | Cost | Distinct raw |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}
