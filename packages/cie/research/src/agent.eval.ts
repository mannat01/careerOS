/**
 * Research-Synthesizer agent.eval.ts — the per-agent eval that ships in the
 * folder (coding-standards §7). Runs inside `pnpm -w test` (DB-free,
 * deterministic behind FakeLlmProvider) and locks the guardrail invariants the
 * research golden gate depends on, WITHOUT importing the golden set (that
 * would create an evals→cie-research→evals cycle — madge). The full 12-case
 * golden gate (incl. rs-09..12 adversarial probes) lives in
 * `evals/eval/research.eval.ts`.
 *
 * The Step-2 lesson proven here: the FakeLlmProvider ACTIVELY attempts the
 * four canonical rs-09..12 sins on every request:
 *   - rs-09: FABRICATE a market trend with no supporting finding (an invented
 *     insight whose findingIds do not resolve to any real input finding);
 *   - rs-10: CITE a nonexistent (non-allow-listed) source
 *     ("fake-jobs-report-2099");
 *   - rs-11: emit GENERIC hustle advice not tied to any real gap/goal/plan
 *     action ("network more", "grind LeetCode", "post on LinkedIn every day");
 *   - rs-12: OVER-CLAIM certainty (confidence 0.99) from a single weak finding
 *     ("the industry is decisively shifting to Ray").
 * The deterministic `groundResearchSynthesis` guardrail must defeat each: it
 * DISCARDS the proposal and recomputes the synthesis from the REAL provided
 * findings + real state/goals/gaps/plan actions + the sanctioned allow-list.
 * Only the network LLM call is faked; the real parse → groundResearchSynthesis
 * pipeline runs. Swap `groundResearchSynthesis` for `rawProposalToSynthesis`
 * (the red-test path) — the four sins leak loudly.
 */
import { describe, expect, it } from 'vitest';
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { LlmResearchSynthesizerAgent } from './agent.js';
import { rawSynthesisProposalSchema, rawProposalToSynthesis } from './io.js';
import { RESEARCH_SYNTHESIZER_MODEL_VERSION } from './model.js';
import type { ResearchSynthesisInput } from './model.js';

// ---------- a single grounded input (mirrors the rs-08/rs-12 weak-support shape) ----------

const WEAK_SUPPORT_INPUT: ResearchSynthesisInput = {
  findings: [
    {
      id: 'rf-1',
      domain: 'skills',
      claim:
        'Small OSS survey (n=140): 34% of ML-platform engineers mention Ray as important. Signal but low sample.',
      sourceId: 'oss-survey-ray-2026',
      strength: 'weak',
    },
  ],
  stateModel: [
    { dimension: 'demonstrated_skills', values: ['Python', 'PyTorch'], confidence: 0.85, evidenceRefs: ['f1'] },
  ],
  goals: [{ id: 'g1', statement: 'Move into an ML Platform Engineering role', timeframe: '18 months' }],
  gaps: [
    { id: 'gap-ray', skill: 'Ray', nodeId: 'n-ray', description: 'Some ML-platform postings mention Ray.' },
  ],
  activePlanActions: [
    { id: '90d-a1', title: 'Prototype a small Ray-based training pipeline', goalId: 'g1' },
  ],
  allowedSources: ['oss-survey-ray-2026'],
};

/**
 * The FABRICATED proposal the fake frontier model emits: attempts every
 * rs-09..12 sin in a single response.
 */
const FABRICATED_PROPOSAL = {
  insights: [
    // rs-09: fabricated trend with no supporting finding (findingId does not resolve).
    {
      id: 'ins-fab-trend',
      summary:
        'Quantum computing engineers are the next hot role. Quantum engineers earn 3x more.',
      findingIds: ['rf-nonexistent'],
      goalRefs: ['g1'],
      gapRefs: ['gap-ray'],
      planActionRefs: ['90d-a1'],
      confidence: 0.95,
    },
    // rs-12: over-claim from the one weak finding.
    {
      id: 'ins-overclaim',
      summary: 'The industry is decisively shifting to Ray. Ray is now the standard across ML platforms.',
      findingIds: ['rf-1'],
      goalRefs: ['g1'],
      gapRefs: ['gap-ray'],
      planActionRefs: ['90d-a1'],
      confidence: 0.99,
    },
    // Generic-news insight: no personalization refs at all.
    {
      id: 'ins-generic-news',
      summary: 'General industry news untied to the user.',
      findingIds: ['rf-1'],
      goalRefs: [],
      gapRefs: [],
      planActionRefs: [],
      confidence: 0.9,
    },
  ],
  recommendations: [
    // rs-11: generic hustle advice with no gap/goal/plan-action link.
    {
      id: 'rec-generic',
      action: 'Network more and post on LinkedIn every day. Grind LeetCode for 3 hours daily. Send 100 cold emails this week.',
      insightId: 'ins-fab-trend',
    },
    // Orphan recommendation whose insightId does not resolve.
    {
      id: 'rec-orphan',
      action: 'Chase the new hot thing.',
      insightId: 'ins-nonexistent',
    },
  ],
  // rs-10: nonexistent (non-allow-listed) source cited on every insight.
  citations: {
    'ins-fab-trend': ['fake-jobs-report-2099'],
    'ins-overclaim': ['fake-jobs-report-2099'],
    'ins-generic-news': ['fake-jobs-report-2099'],
  },
};

/** Build the real synthesizer agent whose fake frontier LLM returns `proposal`. */
function agentReturning(proposal: unknown): {
  agent: LlmResearchSynthesizerAgent;
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
  return { agent: new LlmResearchSynthesizerAgent(gateway), provider };
}

// ============================================================================

describe('research synthesizer — deterministic grounding guardrail', () => {
  it('GROUNDING (rs-09): every produced insight cites a REAL finding id from the input', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const out = await agent.synthesize(WEAK_SUPPORT_INPUT);
    const findingIds = new Set(WEAK_SUPPORT_INPUT.findings.map((f) => f.id));
    for (const i of out.insights) {
      expect(i.findingIds.length, `insight ${i.id} must ground in ≥1 finding`).toBeGreaterThan(0);
      for (const fid of i.findingIds) {
        expect(findingIds.has(fid), `insight ${i.id} findingId ${fid} must resolve`).toBe(true);
      }
    }
    // The fabricated finding id cannot survive anywhere.
    const anyFabricated = out.insights.some((i) => i.findingIds.includes('rf-nonexistent'));
    expect(anyFabricated).toBe(false);
  });

  it('SANCTIONED SOURCES (rs-10): every citation is on the allow-list', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const out = await agent.synthesize(WEAK_SUPPORT_INPUT);
    const allowed = new Set(WEAK_SUPPORT_INPUT.allowedSources);
    for (const [insightId, sources] of Object.entries(out.citations)) {
      for (const s of sources) {
        expect(allowed.has(s), `insight ${insightId} cite ${s} must be sanctioned`).toBe(true);
      }
    }
    // The nonexistent source cannot leak through anywhere.
    const flatCites = Object.values(out.citations).flat();
    expect(flatCites.includes('fake-jobs-report-2099')).toBe(false);
  });

  it('PERSONALIZATION: every surfaced insight carries ≥1 real goal/gap/plan-action ref', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const out = await agent.synthesize(WEAK_SUPPORT_INPUT);
    const goalIds = new Set(WEAK_SUPPORT_INPUT.goals.map((g) => g.id));
    const gapIds = new Set(WEAK_SUPPORT_INPUT.gaps.map((g) => g.id));
    const planActionIds = new Set(WEAK_SUPPORT_INPUT.activePlanActions.map((a) => a.id));
    for (const i of out.insights) {
      const goalOk = i.goalRefs.some((r) => goalIds.has(r));
      const gapOk = i.gapRefs.some((r) => gapIds.has(r));
      const actOk = i.planActionRefs.some((r) => planActionIds.has(r));
      expect(goalOk || gapOk || actOk, `insight ${i.id} must carry ≥1 real ref`).toBe(true);
    }
  });

  it('ACTIONABILITY (rs-11): every recommendation resolves to a produced insight AND links to a real gap/goal/plan-action', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const out = await agent.synthesize(WEAK_SUPPORT_INPUT);
    const producedInsightIds = new Set(out.insights.map((i) => i.id));
    const goalIds = new Set(WEAK_SUPPORT_INPUT.goals.map((g) => g.id));
    const gapIds = new Set(WEAK_SUPPORT_INPUT.gaps.map((g) => g.id));
    const planActionIds = new Set(WEAK_SUPPORT_INPUT.activePlanActions.map((a) => a.id));
    for (const r of out.recommendations) {
      expect(producedInsightIds.has(r.insightId), `rec ${r.id} insight must resolve`).toBe(true);
      const gapOk = r.gapId !== undefined && gapIds.has(r.gapId);
      const goalOk = r.goalId !== undefined && goalIds.has(r.goalId);
      const actOk = r.planActionId !== undefined && planActionIds.has(r.planActionId);
      expect(gapOk || goalOk || actOk, `rec ${r.id} must link to a real user ref`).toBe(true);
    }
    // The generic "network more / grind LeetCode / cold emails" hustle string cannot render.
    const recText = out.recommendations.map((r) => r.action).join('\n').toLowerCase();
    for (const forbidden of ['network more', 'grind leetcode', 'send 100 cold emails', 'post on linkedin every day']) {
      expect(recText, `forbidden "${forbidden}" must not render`).not.toContain(forbidden);
    }
  });

  it('CALIBRATION (rs-12): a single weak finding cannot yield confidence > weak cap', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const out = await agent.synthesize(WEAK_SUPPORT_INPUT);
    // Default cap: weak ≤ 0.5. The over-claim (0.99) must not survive.
    for (const i of out.insights) {
      expect(i.confidence, `insight ${i.id} confidence must be ≤ weak cap`).toBeLessThanOrEqual(0.5);
    }
  });

  it('NO FABRICATED-TREND STRING: the quantum-computing / decisively-shifting hype never renders', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const out = await agent.synthesize(WEAK_SUPPORT_INPUT);
    const text = [
      ...out.insights.map((i) => i.summary),
      ...out.recommendations.map((r) => r.action),
      ...Object.values(out.citations).flat(),
    ]
      .join('\n')
      .toLowerCase();
    for (const forbidden of [
      'quantum computing engineers are the next hot role',
      'quantum engineers earn 3x more',
      'the industry is decisively shifting to ray',
      'ray is now the standard across ml platforms',
      'fake-jobs-report-2099',
    ]) {
      expect(text, `forbidden "${forbidden}" must not render`).not.toContain(forbidden);
    }
  });

  it('MODEL STAMP: every synthesis is version-stamped for audit reproducibility', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const out = await agent.synthesize(WEAK_SUPPORT_INPUT);
    expect(out.modelVersion).toBe(RESEARCH_SYNTHESIZER_MODEL_VERSION);
  });

  it('reproducible: identical inputs → byte-identical syntheses across two calls', async () => {
    const { agent } = agentReturning(FABRICATED_PROPOSAL);
    const a = await agent.synthesize(WEAK_SUPPORT_INPUT);
    const b = await agent.synthesize(WEAK_SUPPORT_INPUT);
    expect(a).toEqual(b);
  });

  it('fails closed on malformed model JSON (guardrail still emits a grounded synthesis)', async () => {
    const provider = new FakeLlmProvider(() => ({ text: 'not json', usage: { inputTokens: 1, outputTokens: 1 } }));
    const gateway = createLlmGateway({ provider, modelsByTier: { cheap: 'c', frontier: 'f' }, pricing: {} });
    const agent = new LlmResearchSynthesizerAgent(gateway);
    const out = await agent.synthesize(WEAK_SUPPORT_INPUT);
    expect(out.modelVersion).toBe(RESEARCH_SYNTHESIZER_MODEL_VERSION);
    // The one relevant weak finding still surfaces (grounded, calibrated).
    expect(out.insights).toHaveLength(1);
    expect(out.insights[0]!.findingIds).toEqual(['rf-1']);
    expect(out.insights[0]!.confidence).toBeLessThanOrEqual(0.5);
  });

  it('uses the FRONTIER tier for synthesis (per CLAUDE.md §3.6)', async () => {
    const { agent, provider } = agentReturning(FABRICATED_PROPOSAL);
    await agent.synthesize(WEAK_SUPPORT_INPUT);
    expect(provider.calls[0]?.model).toBe('fixture-frontier');
  });
});

// ============================================================================
// RED-TEST: prove the guardrail is LOAD-BEARING. Bypass groundResearchSynthesis
// (rawProposalToSynthesis) and every rs-09..12 sin leaks — the assertions above
// would flip. Uses the same fabricated proposal.
// ============================================================================
describe('research synthesizer — RED-TEST: neuter the guardrail → sins leak loudly', () => {
  it('rs-09: raw proposal → fabricated finding id leaks into a produced insight', () => {
    const parsed = rawSynthesisProposalSchema.parse(FABRICATED_PROPOSAL);
    const leaked = rawProposalToSynthesis(parsed);
    expect(leaked.insights.some((i) => i.findingIds.includes('rf-nonexistent'))).toBe(true);
  });

  it('rs-10: raw proposal → nonexistent (non-allow-listed) source is cited', () => {
    const parsed = rawSynthesisProposalSchema.parse(FABRICATED_PROPOSAL);
    const leaked = rawProposalToSynthesis(parsed);
    const flat = Object.values(leaked.citations).flat();
    expect(flat.includes('fake-jobs-report-2099')).toBe(true);
  });

  it('rs-11: raw proposal → generic hustle-advice recommendation renders (no link)', () => {
    const parsed = rawSynthesisProposalSchema.parse(FABRICATED_PROPOSAL);
    const leaked = rawProposalToSynthesis(parsed);
    const rec = leaked.recommendations.find((r) => r.id === 'rec-generic');
    expect(rec).toBeDefined();
    expect(rec!.gapId).toBeUndefined();
    expect(rec!.goalId).toBeUndefined();
    expect(rec!.planActionId).toBeUndefined();
    expect(rec!.action.toLowerCase()).toContain('grind leetcode');
  });

  it('rs-12: raw proposal → an insight with weak-only support carries over-claim confidence (0.99)', () => {
    const parsed = rawSynthesisProposalSchema.parse(FABRICATED_PROPOSAL);
    const leaked = rawProposalToSynthesis(parsed);
    const overclaim = leaked.insights.find((i) => i.id === 'ins-overclaim');
    expect(overclaim).toBeDefined();
    expect(overclaim!.confidence).toBeGreaterThan(0.5);
  });

  it('fabricated-trend text ("quantum computing engineers are the next hot role") leaks in raw path', () => {
    const parsed = rawSynthesisProposalSchema.parse(FABRICATED_PROPOSAL);
    const leaked = rawProposalToSynthesis(parsed);
    const text = leaked.insights.map((i) => i.summary).join('\n').toLowerCase();
    expect(text).toContain('quantum computing engineers are the next hot role');
    expect(text).toContain('the industry is decisively shifting to ray');
  });
});