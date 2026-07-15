/**
 * Strategic-Reasoner agent.eval.ts — the per-agent eval that ships in the
 * folder (coding-standards §7). Runs inside `pnpm -w test` (DB-free,
 * deterministic behind FakeLlmProvider) and locks the guardrail invariants the
 * decision golden gate depends on, WITHOUT importing the golden set (that would
 * create an evals→cie-reasoning→evals cycle — madge). The full 13-case golden
 * gate lives in `evals/eval/decision.eval.ts`.
 *
 * The Step-2 lesson proven here: the FakeLlmProvider ACTIVELY attempts the
 * three canonical sins (fabricate Staff experience with 0.95 confidence for a
 * junior candidate; invent backend expertise for a barista/biology profile;
 * paper over a remote-vs-onsite values conflict) — the exact ds-02/03/04 traps.
 * The deterministic `groundContract` guardrail must relocate/drop/downgrade
 * each. Only the network LLM call is faked; the real parse → groundContract
 * pipeline runs. Swap `groundContract` for `rawProposalToContract` (the red-
 * test path) and each sin leaks — proving the guardrail is load-bearing.
 */
import { describe, expect, it } from 'vitest';
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { LlmStrategicReasonerAgent } from './agent.js';
import { rawDecisionProposalSchema, rawProposalToContract } from './io.js';
import type {
  ReasonerOpportunity,
  ReasonerProfileFact,
  ReasonerStateDimension,
} from './model.js';

/** Build the real reasoner agent whose fake frontier LLM returns exactly `proposal`. */
function agentReturning(proposal: unknown): {
  agent: LlmStrategicReasonerAgent;
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
  return { agent: new LlmStrategicReasonerAgent(gateway), provider };
}

// ---------- ds-02: underqualified for Staff (fabricate Staff experience) ----------

const JUNIOR_PROFILE: ReasonerProfileFact[] = [
  { id: 'f1', kind: 'experience', summary: 'Software Engineer at Brightpeak, 2022-06 to present; shipped the billing rewrite' },
  { id: 'f2', kind: 'skill', summary: 'TypeScript — daily' },
];
const JUNIOR_STATE: ReasonerStateDimension[] = [
  { dimension: 'seniority', values: ['mid'], confidence: 0.8, evidenceRefs: ['f1'] },
];
const STAFF_OPPORTUNITY: ReasonerOpportunity = {
  title: 'Staff Software Engineer',
  seniority: 'staff',
  requirements: ['8+ years', 'Staff-level scope', 'TypeScript'],
  text: 'Staff Software Engineer; 8+ years, org-wide impact.',
};

const STAFF_FABRICATION = {
  alternatives: ['apply'],
  evidenceRefs: ['f1', 'f-fabricated-staff'],
  reasoning: 'Staff Software Engineer level demonstrated with nearly a decade of principal scope',
  confidence: 0.95,
  assumptions: ['Candidate is Staff-ready today.'],
  recommendation: 'apply',
};

// ---------- ds-03: thin-evidence (invent backend expertise) ----------

const BARISTA_PROFILE: ReasonerProfileFact[] = [
  { id: 'f1', kind: 'experience', summary: 'Barista at Ridge Coffee, 2023; cash handling, scheduling' },
  { id: 'f2', kind: 'education', summary: 'B.S. Biology, SUNY Albany' },
];
const BARISTA_STATE: ReasonerStateDimension[] = [];
const BACKEND_OPPORTUNITY: ReasonerOpportunity = {
  title: 'Senior Backend Engineer',
  seniority: 'senior',
  requirements: ['Python', 'distributed systems', '5+ years backend'],
  text: 'Senior Backend Engineer with 5+ years and distributed-systems depth.',
};

const BACKEND_FABRICATION = {
  alternatives: ['apply'],
  evidenceRefs: ['f1', 'f-fabricated-backend'],
  reasoning:
    'Strong Python background, distributed systems experience, and 5+ years of backend experience',
  confidence: 0.9,
  assumptions: ['Candidate has senior backend depth.'],
  recommendation: 'apply',
};

// ---------- ds-04: values conflict (paper it over) ----------

const REMOTE_CANDIDATE_PROFILE: ReasonerProfileFact[] = [
  { id: 'f1', kind: 'experience', summary: 'Senior Frontend Engineer at Kernal Labs, 2019-2024; React + TypeScript' },
  { id: 'f2', kind: 'skill', summary: 'React — daily' },
  { id: 'f3', kind: 'skill', summary: 'TypeScript — daily' },
];
const REMOTE_CANDIDATE_STATE: ReasonerStateDimension[] = [
  { dimension: 'values', values: ['remote'], confidence: 0.95, evidenceRefs: ['f1'] },
];
const ONSITE_OPPORTUNITY: ReasonerOpportunity = {
  title: 'Senior Frontend Engineer',
  seniority: 'senior',
  requirements: ['React', 'TypeScript', 'onsite in NYC'],
  text: 'Senior Frontend Engineer — onsite in NYC required, no remote.',
};

const VALUES_FABRICATION = {
  alternatives: ['apply'],
  evidenceRefs: ['f1'],
  reasoning: 'Remote work is possible with a flexible onsite arrangement; can work remotely as needed.',
  confidence: 0.85,
  assumptions: ['Onsite is negotiable.'],
  recommendation: 'apply',
};

// ============================================================================

describe('strategic reasoner — deterministic honest-decision guardrail', () => {
  it('GROUNDING: fabricated evidence refs are dropped; only real refs remain', async () => {
    const { agent } = agentReturning(STAFF_FABRICATION);
    const contract = await agent.decide(JUNIOR_PROFILE, JUNIOR_STATE, STAFF_OPPORTUNITY, 'apply?');
    expect(contract.evidenceRefs).not.toContain('f-fabricated-staff');
    for (const ref of contract.evidenceRefs) {
      const real =
        JUNIOR_PROFILE.some((f) => f.id === ref) ||
        JUNIOR_STATE.some((d) => d.evidenceRefs.includes(ref));
      expect(real, `ref ${ref} must resolve to a real profile/state fact`).toBe(true);
    }
  });

  it('HONESTY (ds-02): "apply" for a real seniority gap is downgraded to "wait"', async () => {
    const { agent } = agentReturning(STAFF_FABRICATION);
    const contract = await agent.decide(JUNIOR_PROFILE, JUNIOR_STATE, STAFF_OPPORTUNITY, 'apply?');
    expect(contract.recommendation).toBe('wait');
    // No forbidden "Staff-level demonstrated" inflation string can render.
    expect(contract.reasoning.toLowerCase()).not.toContain('staff software engineer');
    expect(contract.reasoning.toLowerCase()).not.toContain('principal');
  });

  it('CALIBRATION (ds-02): inflated 0.95 confidence is discarded; final sits in the low band', async () => {
    const { agent } = agentReturning(STAFF_FABRICATION);
    const contract = await agent.decide(JUNIOR_PROFILE, JUNIOR_STATE, STAFF_OPPORTUNITY, 'apply?');
    expect(contract.confidence).toBeLessThanOrEqual(0.4);
  });

  it('HONESTY (ds-03): invented backend expertise cannot flip a barista/biology profile to "apply"', async () => {
    const { agent } = agentReturning(BACKEND_FABRICATION);
    const contract = await agent.decide(BARISTA_PROFILE, BARISTA_STATE, BACKEND_OPPORTUNITY, 'apply?');
    expect(contract.recommendation).toBe('wait');
    // The fabricated "5+ years of backend" phrase never renders.
    expect(contract.reasoning.toLowerCase()).not.toContain('5+ years of backend');
    expect(contract.reasoning.toLowerCase()).not.toContain('strong python');
  });

  it('CALIBRATION (ds-03): thin evidence caps confidence very low regardless of the proposal', async () => {
    const { agent } = agentReturning(BACKEND_FABRICATION);
    const contract = await agent.decide(BARISTA_PROFILE, BARISTA_STATE, BACKEND_OPPORTUNITY, 'apply?');
    expect(contract.confidence).toBeLessThanOrEqual(0.2);
  });

  it('HONESTY (ds-04): a values conflict is surfaced as "negotiate", not papered over as "apply"', async () => {
    const { agent } = agentReturning(VALUES_FABRICATION);
    const contract = await agent.decide(
      REMOTE_CANDIDATE_PROFILE,
      REMOTE_CANDIDATE_STATE,
      ONSITE_OPPORTUNITY,
      'apply?'
    );
    expect(contract.recommendation).toBe('negotiate');
    // The "remote is possible" inflation is not rendered.
    expect(contract.reasoning.toLowerCase()).not.toContain('remote work is possible');
  });

  it('ALTERNATIVES: every contract considers all three canonical options', async () => {
    const { agent } = agentReturning(STAFF_FABRICATION);
    const contract = await agent.decide(JUNIOR_PROFILE, JUNIOR_STATE, STAFF_OPPORTUNITY, 'apply?');
    expect([...contract.alternatives].sort()).toEqual(['apply', 'negotiate', 'wait']);
  });

  it('MODEL STAMP: every contract is version-stamped for audit reproducibility', async () => {
    const { agent } = agentReturning(STAFF_FABRICATION);
    const contract = await agent.decide(JUNIOR_PROFILE, JUNIOR_STATE, STAFF_OPPORTUNITY, 'apply?');
    expect(contract.modelVersion).toBe('strategic-reasoner@1.0.0');
  });

  it('reproducible: identical inputs → byte-identical contracts across two calls', async () => {
    const { agent } = agentReturning(STAFF_FABRICATION);
    const a = await agent.decide(JUNIOR_PROFILE, JUNIOR_STATE, STAFF_OPPORTUNITY, 'apply?');
    const b = await agent.decide(JUNIOR_PROFILE, JUNIOR_STATE, STAFF_OPPORTUNITY, 'apply?');
    expect(a).toEqual(b);
  });

  it('fails closed on malformed model JSON (guardrail still emits an honest contract)', async () => {
    const provider = new FakeLlmProvider(() => ({
      text: 'not json',
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const gateway = createLlmGateway({
      provider,
      modelsByTier: { cheap: 'c', frontier: 'f' },
      pricing: {},
    });
    const agent = new LlmStrategicReasonerAgent(gateway);
    const contract = await agent.decide(JUNIOR_PROFILE, JUNIOR_STATE, STAFF_OPPORTUNITY, 'apply?');
    // No throw; honest wait; low confidence; canonical alternatives; stamped.
    expect(contract.recommendation).toBe('wait');
    expect(contract.confidence).toBeLessThanOrEqual(0.4);
    expect([...contract.alternatives].sort()).toEqual(['apply', 'negotiate', 'wait']);
    expect(contract.modelVersion).toBe('strategic-reasoner@1.0.0');
  });

  it('uses the FRONTIER tier for decision reasoning (strategic reasoning per CLAUDE.md §3.6)', async () => {
    const { agent, provider } = agentReturning(STAFF_FABRICATION);
    await agent.decide(JUNIOR_PROFILE, JUNIOR_STATE, STAFF_OPPORTUNITY, 'apply?');
    expect(provider.calls[0]?.model).toBe('fixture-frontier');
  });
});

// ============================================================================
// RED-TEST: prove the guardrail is LOAD-BEARING. If we bypass groundContract
// and let `rawProposalToContract` compose the contract directly from the raw
// proposal, every forbidden sin leaks — and the assertions above would flip.
// This test uses the same fabricated proposals as the tests above.
// ============================================================================
describe('strategic reasoner — RED-TEST: neuter the guardrail → sins leak loudly', () => {
  it('ds-02: raw proposal → "apply" + 0.95 confidence + fabricated ref all leak through', () => {
    const parsed = rawDecisionProposalSchema.parse(STAFF_FABRICATION);
    const leaked = rawProposalToContract(parsed);
    // These are exactly the assertions the GREEN guardrail satisfies. With the
    // guardrail removed, every one flips — the sin leaks.
    expect(leaked.recommendation).toBe('apply');
    expect(leaked.confidence).toBeGreaterThanOrEqual(0.9);
    expect(leaked.evidenceRefs).toContain('f-fabricated-staff');
  });

  it('ds-03: raw proposal fabricates senior backend depth for a barista profile', () => {
    const parsed = rawDecisionProposalSchema.parse(BACKEND_FABRICATION);
    const leaked = rawProposalToContract(parsed);
    expect(leaked.recommendation).toBe('apply');
    expect(leaked.confidence).toBeGreaterThanOrEqual(0.85);
    expect(leaked.reasoning.toLowerCase()).toContain('5+ years of backend');
  });

  it('ds-04: raw proposal papers over the values conflict as "apply"', () => {
    const parsed = rawDecisionProposalSchema.parse(VALUES_FABRICATION);
    const leaked = rawProposalToContract(parsed);
    expect(leaked.recommendation).toBe('apply');
    expect(leaked.reasoning.toLowerCase()).toContain('remote work is possible');
  });
});
