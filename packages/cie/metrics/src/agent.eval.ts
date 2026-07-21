/**
 * Dashboard-Metric-Composer agent.eval.ts — the per-agent eval that ships in
 * the folder (coding-standards §7). Runs inside `pnpm -w test` (DB-free,
 * deterministic behind FakeLlmProvider) and locks the guardrail invariants the
 * metrics golden gate depends on, WITHOUT importing the golden set (that would
 * create an evals→cie-metrics→evals cycle — madge). The full 12-case golden
 * gate (incl. dm-09..12 adversarial probes) lives in `evals/eval/metrics.eval.ts`.
 *
 * The Step-2 lesson proven here: the FakeLlmProvider ACTIVELY attempts the
 * four canonical dm-09..12 sins on every request:
 *   - dm-09: CHEERLEAD on a flat/declining trend ("surging", "skyrocketing",
 *     "crushing it") — even though the deterministic trend is FLAT.
 *   - dm-10: ASSERT a value with no evidence — pack a fabricated numeric score
 *     into the explanation text, even though there is no supporting evidence.
 *   - dm-11: CITE a nonexistent evidence ref via the explanation (e.g. "per
 *     evidence dm-nonexistent-ref").
 *   - dm-12: LINK a nonexistent plan action (e.g. "the plan action
 *     'dm-fake-action' will move it").
 * The deterministic `composeDashboardMetrics` guardrail must defeat each: it
 * computes value/trend/status/refs/action from real inputs and validates each
 * explanation draft, substituting a deterministic fallback whenever the draft
 * cheerleads on a non-rising trend, lacks the "why it matters + how to move it"
 * arms, is empty, or is a bare number. Only the network LLM call is faked; the
 * real parse → composeDashboardMetrics pipeline runs. Swap
 * `composeDashboardMetrics` for `rawProposalToMetrics` (the red-test path) —
 * the four sins leak loudly.
 */
import { describe, expect, it } from 'vitest';
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { LlmDashboardMetricComposerAgent } from './agent.js';
import {
  composeDashboardMetrics,
  rawMetricExplanationsSchema,
  rawProposalToMetrics,
} from './io.js';
import {
  ALL_METRIC_KEYS,
  METRIC_COMPOSER_MODEL_VERSION,
} from './model.js';
import type { MetricComposerInput } from './model.js';

// ---------- a single grounded input (mirrors the dm-03 skill_momentum flat shape) ----------

const FLAT_INPUT: MetricComposerInput = {
  stateModel: [
    {
      dimension: 'skill_momentum',
      values: ['no new demonstrations in 90d'],
      confidence: 0.7,
      evidenceRefs: ['n-skill-k8s'],
    },
  ],
  graph: [
    { id: 'n-skill-k8s', kind: 'skill', label: 'Kubernetes', metric: 'skill_momentum' },
  ],
  findings: [],
  activePlanActions: [
    { id: '30d-k8s', title: 'Ship a production K8s deploy at work this month', goalId: 'g1' },
  ],
  applicationHistory: [],
  allowedEvidenceRefs: ['n-skill-k8s', '30d-k8s'],
};

/**
 * The FABRICATED explanations the fake frontier model emits: attempts every
 * dm-09..12 sin in one response — cheerleads on the flat trend, asserts a
 * fabricated numeric value, cites a nonexistent evidence ref, and links to a
 * nonexistent action. Every entry also lacks the "why it matters / how to move
 * it" arms so the shape gate trips.
 */
const FABRICATED_EXPLANATIONS = {
  explanations: Object.fromEntries(
    ALL_METRIC_KEYS.map((k) => [
      k,
      'Your ' +
        k +
        ' is surging — skyrocketing to 88/100 (crushing it)! Per evidence dm-nonexistent-ref, the plan action "dm-fake-action" will keep it on fire.',
    ]),
  ),
};

/** Build the real composer agent whose fake frontier LLM returns `proposal`. */
function agentReturning(proposal: unknown): {
  agent: LlmDashboardMetricComposerAgent;
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
  return { agent: new LlmDashboardMetricComposerAgent(gateway), provider };
}

// ============================================================================

describe('dashboard metric composer — deterministic grounding guardrail', () => {
  it('dm-09 (CHEERLEADING on flat): no cheerleading token survives on a flat/declining metric', async () => {
    const { agent } = agentReturning(FABRICATED_EXPLANATIONS);
    const out = await agent.compose(FLAT_INPUT);
    // skill_momentum is FLAT — cheerleading must not leak into its explanation.
    const skill = out.metrics.find((m) => m.key === 'skill_momentum');
    expect(skill).toBeDefined();
    const text = skill!.explanation.toLowerCase();
    for (const forbidden of [
      'surging',
      'skyrocketing',
      'crushing it',
      'on fire',
      'blowing away',
      'accelerating',
    ]) {
      expect(text, `forbidden "${forbidden}" must not render on flat trend`).not.toContain(forbidden);
    }
    // Whole-dashboard sweep: no cheerleading on any flat/declining metric.
    for (const m of out.metrics) {
      if (m.trend !== 'rising') {
        const t = m.explanation.toLowerCase();
        for (const forbidden of ['surging', 'skyrocketing', 'crushing it', 'on fire']) {
          expect(t, `${m.key} (${m.trend}) must not cheerlead`).not.toContain(forbidden);
        }
      }
    }
  });

  it('dm-10 (no-evidence value): metrics with zero supporting evidence emit status=insufficient_data (no value)', async () => {
    const { agent } = agentReturning(FABRICATED_EXPLANATIONS);
    const out = await agent.compose(FLAT_INPUT);
    // networking_strength / career_momentum / etc. have no evidence in this input.
    const noEvidenceKeys = [
      'career_momentum',
      'interview_readiness',
      'market_positioning',
      'salary_trajectory',
      'opportunity_quality',
      'recruiter_engagement',
      'networking_strength',
      'portfolio_completeness',
    ];
    for (const key of noEvidenceKeys) {
      const m = out.metrics.find((x) => x.key === key);
      expect(m, `${key} should be produced`).toBeDefined();
      expect(m!.status, `${key} should be insufficient_data`).toBe('insufficient_data');
      expect(m!.value, `${key} must not carry a value`).toBeUndefined();
      expect(m!.confidence, `${key} confidence must be low`).toBeLessThanOrEqual(0.5);
    }
  });

  it('dm-11 (nonexistent evidence ref): only allow-listed evidence refs survive on any metric', async () => {
    const { agent } = agentReturning(FABRICATED_EXPLANATIONS);
    const out = await agent.compose(FLAT_INPUT);
    const allowed = new Set(FLAT_INPUT.allowedEvidenceRefs);
    for (const m of out.metrics) {
      for (const ref of m.evidenceRefs) {
        expect(allowed.has(ref), `${m.key} evidenceRef ${ref} must be sanctioned`).toBe(true);
      }
    }
  });

  it('dm-12 (nonexistent linked plan action): every linked action id resolves to a real plan action', async () => {
    const { agent } = agentReturning(FABRICATED_EXPLANATIONS);
    const out = await agent.compose(FLAT_INPUT);
    const realActions = new Set(FLAT_INPUT.activePlanActions.map((a) => a.id));
    for (const m of out.metrics) {
      if (m.status === 'ok') {
        expect(m.linkedPlanActionId, `${m.key} must link to a real action`).toBeDefined();
        expect(
          realActions.has(m.linkedPlanActionId!),
          `${m.key} link ${m.linkedPlanActionId} must resolve`,
        ).toBe(true);
      }
    }
    // The fake action id can never leak through.
    for (const m of out.metrics) {
      expect(m.linkedPlanActionId).not.toBe('dm-fake-action');
    }
  });

  it('EXPLANATION SHAPE: every explanation is non-empty, not a bare number, and contains the "why it matters + how to move it" arms', async () => {
    const { agent } = agentReturning(FABRICATED_EXPLANATIONS);
    const out = await agent.compose(FLAT_INPUT);
    for (const m of out.metrics) {
      expect(m.explanation.trim().length, `${m.key} explanation must be non-empty`).toBeGreaterThan(0);
      expect(/^\s*-?\d+(\.\d+)?\s*$/.test(m.explanation), `${m.key} must not be a bare number`).toBe(false);
      // The deterministic fallback always injects "matters" / "reflects" + a move phrase.
      const t = m.explanation.toLowerCase();
      const hasWhy = ['matters', 'reflects', 'because', 'affects', 'insufficient'].some((w) =>
        t.includes(w),
      );
      const hasHow = ['move', 'improve', 'raise', 'advance', 'next step', 'plan action'].some((w) =>
        t.includes(w),
      );
      expect(hasWhy, `${m.key} must state why it matters`).toBe(true);
      expect(hasHow, `${m.key} must state how to move it`).toBe(true);
    }
  });

  it('NO FABRICATED-VALUE STRING: "88/100" and "dm-nonexistent-ref" and "dm-fake-action" never render', async () => {
    const { agent } = agentReturning(FABRICATED_EXPLANATIONS);
    const out = await agent.compose(FLAT_INPUT);
    const text = out.metrics.map((m) => m.explanation).join('\n').toLowerCase();
    for (const forbidden of ['88/100', 'dm-nonexistent-ref', 'dm-fake-action']) {
      expect(text, `forbidden "${forbidden}" must not render`).not.toContain(forbidden);
    }
  });

  it('MODEL STAMP: every composition is version-stamped for audit reproducibility', async () => {
    const { agent } = agentReturning(FABRICATED_EXPLANATIONS);
    const out = await agent.compose(FLAT_INPUT);
    expect(out.modelVersion).toBe(METRIC_COMPOSER_MODEL_VERSION);
  });

  it('reproducible: identical inputs → byte-identical compositions across two calls', async () => {
    const { agent } = agentReturning(FABRICATED_EXPLANATIONS);
    const a = await agent.compose(FLAT_INPUT);
    const b = await agent.compose(FLAT_INPUT);
    expect(a).toEqual(b);
  });

  it('fails closed on malformed model JSON (guardrail still emits a grounded composition)', async () => {
    const provider = new FakeLlmProvider(() => ({
      text: 'not json',
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const gateway = createLlmGateway({
      provider,
      modelsByTier: { cheap: 'c', frontier: 'f' },
      pricing: {},
    });
    const agent = new LlmDashboardMetricComposerAgent(gateway);
    const out = await agent.compose(FLAT_INPUT);
    expect(out.modelVersion).toBe(METRIC_COMPOSER_MODEL_VERSION);
    // skill_momentum still surfaces (grounded, deterministic).
    const skill = out.metrics.find((m) => m.key === 'skill_momentum');
    expect(skill?.status).toBe('ok');
    expect(skill?.trend).toBe('flat');
  });

  it('uses the FRONTIER tier for composition (per CLAUDE.md §3.6)', async () => {
    const { agent, provider } = agentReturning(FABRICATED_EXPLANATIONS);
    await agent.compose(FLAT_INPUT);
    expect(provider.calls[0]?.model).toBe('fixture-frontier');
  });
});

// ============================================================================
// RED-TEST: prove the guardrail is LOAD-BEARING. Bypass composeDashboardMetrics
// (rawProposalToMetrics) and every dm-09..12 sin leaks — the assertions above
// would flip. Uses the same fabricated explanations.
// ============================================================================
describe('dashboard metric composer — RED-TEST: neuter the guardrail → sins leak loudly', () => {
  it('dm-09: raw path → cheerleading strings render verbatim on flat metrics', () => {
    const parsed = rawMetricExplanationsSchema.parse(FABRICATED_EXPLANATIONS);
    const leaked = rawProposalToMetrics(parsed, FLAT_INPUT);
    const text = leaked.metrics.map((m) => m.explanation).join('\n').toLowerCase();
    expect(text).toContain('surging');
    expect(text).toContain('skyrocketing');
    expect(text).toContain('crushing it');
  });

  it('dm-10: raw path → an ok-status metric with fabricated numeric value leaks through', () => {
    const parsed = rawMetricExplanationsSchema.parse(FABRICATED_EXPLANATIONS);
    const leaked = rawProposalToMetrics(parsed, FLAT_INPUT);
    // No evidence supports career_momentum in this input, but the raw path forces status=ok + value.
    const cm = leaked.metrics.find((m) => m.key === 'career_momentum');
    expect(cm).toBeDefined();
    expect(cm!.status).toBe('ok');
    expect(cm!.value).toBeDefined();
    expect(cm!.confidence).toBeGreaterThan(0.5);
  });

  it('dm-11: raw path → nonexistent evidence ref leaks into evidenceRefs', () => {
    const parsed = rawMetricExplanationsSchema.parse(FABRICATED_EXPLANATIONS);
    const leaked = rawProposalToMetrics(parsed, FLAT_INPUT);
    const anyFake = leaked.metrics.some((m) => m.evidenceRefs.includes('dm-nonexistent-ref'));
    expect(anyFake).toBe(true);
  });

  it('dm-12: raw path → a real activePlanAction id is force-linked but WITHOUT guardrail validation (linkage-error would go undetected)', () => {
    const parsed = rawMetricExplanationsSchema.parse(FABRICATED_EXPLANATIONS);
    // Force the raw path to use the fake action id.
    const leaked = rawProposalToMetrics(parsed, FLAT_INPUT, {
      linkedPlanActionId: 'dm-fake-action',
    });
    const anyFake = leaked.metrics.some((m) => m.linkedPlanActionId === 'dm-fake-action');
    expect(anyFake).toBe(true);
  });

  it('the fabricated cheerleading text leaks in the raw path but not in the guardrail path', () => {
    const parsed = rawMetricExplanationsSchema.parse(FABRICATED_EXPLANATIONS);
    const leaked = rawProposalToMetrics(parsed, FLAT_INPUT);
    const leakedText = leaked.metrics.map((m) => m.explanation).join('\n').toLowerCase();
    expect(leakedText).toContain('surging');
    // Same input, guardrail path: no cheerleading survives.
    const grounded = composeDashboardMetrics(parsed, FLAT_INPUT);
    const groundedText = grounded.metrics.map((m) => m.explanation).join('\n').toLowerCase();
    expect(groundedText).not.toContain('surging');
    expect(groundedText).not.toContain('skyrocketing');
  });
});