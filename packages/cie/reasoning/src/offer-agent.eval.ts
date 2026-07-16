/**
 * Offer-Comparison agent.eval.ts — the per-agent eval that ships in the folder
 * (coding-standards §7). Runs inside `pnpm -w test` (DB-free, deterministic
 * behind FakeLlmProvider) and locks the guardrail invariants the offers
 * golden gate depends on, WITHOUT importing the golden set (that would create
 * an evals→cie-reasoning→evals cycle — madge). The full 6-case golden gate
 * lives in `evals/eval/offers.eval.ts`.
 *
 * The Step-3 lesson proven here: the FakeLlmProvider ACTIVELY attempts the
 * three canonical sins:
 *   - INVENT a perk that does not exist in the offers (a "remote flexibility"
 *     phrase where both offers explicitly say onsite);
 *   - INVENT a weight key for a preference the user never stated
 *     ("Kubernetes" as a value when the user only said "learning");
 *   - CITE a phantom offer id ("o-fabricated") that is not in the input.
 * The deterministic `groundOfferComparison` guardrail must drop / recompute
 * each. Only the network LLM call is faked; the real parse → ground pipeline
 * runs. Swap `groundOfferComparison` for `rawProposalToOfferComparison` (the
 * red-test path) and every sin leaks — proving the guardrail is load-bearing.
 */
import { describe, expect, it } from 'vitest';
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { LlmOfferComparisonAgent } from './offer-agent.js';
import {
  rawOfferComparisonProposalSchema,
  rawProposalToOfferComparison,
} from './offer-io.js';
import type { CandidateOffer, CandidateValues } from './offer-model.js';

function agentReturning(proposal: unknown): {
  agent: LlmOfferComparisonAgent;
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
  return { agent: new LlmOfferComparisonAgent(gateway), provider };
}

// ---------- SCENARIO A: invented perk (onsite-only offers) ----------
const ONSITE_VALUES: CandidateValues = {
  goals: ['work-life balance'],
  values: ['remote work', 'reasonable hours'],
  weights: { 'remote work': 0.6, 'reasonable hours': 0.4 },
};
const ONSITE_OFFERS: CandidateOffer[] = [
  {
    id: 'o1',
    title: 'SWE',
    company: 'CityBank',
    attributes: {
      'remote work': 'Onsite in downtown Chicago (no remote option)',
      'reasonable hours': 'Typical 9-5, occasional weekend deployments',
    },
  },
  {
    id: 'o2',
    title: 'SWE',
    company: 'HealthPlus',
    attributes: {
      'remote work': 'Onsite in suburban office (no remote option)',
      'reasonable hours': 'Strict 9-5, no weekend work',
    },
  },
];
const INVENTED_PERK_PROPOSAL = {
  ranking: ['o1', 'o2'],
  weights: { 'remote work': 0.6, 'reasonable hours': 0.4 },
  explanation:
    'CityBank offers a hybrid arrangement with occasional work from home options and remote flexibility.',
  evidenceRefs: ['o1', 'o2'],
};

// ---------- SCENARIO B: invented weight key (thin user values) ----------
const THIN_VALUES: CandidateValues = {
  goals: ['grow technically'],
  values: ['learning opportunities', 'good team'],
  weights: { 'learning opportunities': 0.6, 'good team': 0.4 },
};
const LEARNING_OFFERS: CandidateOffer[] = [
  {
    id: 'o1',
    title: 'SWE',
    company: 'InnovateAI',
    attributes: {
      'learning opportunities': 'Weekly tech talks, $10k annual learning budget',
      'good team': 'Senior engineers from top tech companies',
    },
  },
  {
    id: 'o2',
    title: 'SWE',
    company: 'StableTech',
    attributes: {
      'learning opportunities': 'Quarterly workshops, limited budget',
      'good team': 'Experienced but siloed teams',
    },
  },
];
const INVENTED_WEIGHT_PROPOSAL = {
  ranking: ['o1', 'o2'],
  weights: {
    'learning opportunities': 0.4,
    'good team': 0.3,
    Kubernetes: 0.2,
    'cloud certifications': 0.1,
  },
  explanation: 'InnovateAI aligns with Kubernetes and cloud certifications preferences.',
  evidenceRefs: ['o1', 'o2'],
};

// ---------- SCENARIO C: phantom evidence ref ----------
const PHANTOM_REF_PROPOSAL = {
  ranking: ['o1', 'o2'],
  weights: { 'learning opportunities': 0.6, 'good team': 0.4 },
  explanation: 'InnovateAI ranks first based on stated preferences.',
  evidenceRefs: ['o1', 'o2', 'o-fabricated'],
};

// ============================================================================

describe('offer comparison — deterministic objective-ranking guardrail', () => {
  it('INVENTED PERK: forbidden "remote flexibility" phrase is NOT rendered', async () => {
    const { agent } = agentReturning(INVENTED_PERK_PROPOSAL);
    const out = await agent.compare(ONSITE_VALUES, ONSITE_OFFERS);
    const expl = out.explanation.toLowerCase();
    expect(expl).not.toContain('remote flexibility');
    expect(expl).not.toContain('hybrid arrangement');
    expect(expl).not.toContain('work from home');
  });

  it('INVENTED PERK: guardrail still produces a ranking + real evidence refs', async () => {
    const { agent } = agentReturning(INVENTED_PERK_PROPOSAL);
    const out = await agent.compare(ONSITE_VALUES, ONSITE_OFFERS);
    expect([...out.ranking].sort()).toEqual(['o1', 'o2']);
    // Both offers lack remote — HealthPlus wins on strict 9-5 / no weekend.
    expect(out.ranking[0]).toBe('o2');
    expect(new Set(out.evidenceRefs)).toEqual(new Set(['o1', 'o2']));
  });

  it('INVENTED WEIGHT: the model-added key ("Kubernetes") is DROPPED; only user weights remain', async () => {
    const { agent } = agentReturning(INVENTED_WEIGHT_PROPOSAL);
    const out = await agent.compare(THIN_VALUES, LEARNING_OFFERS);
    expect(Object.keys(out.weights).sort()).toEqual(['good team', 'learning opportunities']);
    expect(out.weights).toEqual(THIN_VALUES.weights);
    expect(out.explanation.toLowerCase()).not.toContain('kubernetes');
    expect(out.explanation.toLowerCase()).not.toContain('cloud certifications');
  });

  it('INVENTED WEIGHT: the user\'s exact numeric weights are echoed byte-for-byte (not rescaled)', async () => {
    const { agent } = agentReturning(INVENTED_WEIGHT_PROPOSAL);
    const out = await agent.compare(THIN_VALUES, LEARNING_OFFERS);
    expect(out.weights['learning opportunities']).toBe(0.6);
    expect(out.weights['good team']).toBe(0.4);
  });

  it('PHANTOM REF: fabricated offer id ("o-fabricated") is dropped; only real offer ids remain', async () => {
    const { agent } = agentReturning(PHANTOM_REF_PROPOSAL);
    const out = await agent.compare(THIN_VALUES, LEARNING_OFFERS);
    expect(out.evidenceRefs).not.toContain('o-fabricated');
    for (const ref of out.evidenceRefs) {
      expect(LEARNING_OFFERS.some((o) => o.id === ref)).toBe(true);
    }
  });

  it('MODEL STAMP: every comparison is version-stamped for audit reproducibility', async () => {
    const { agent } = agentReturning(PHANTOM_REF_PROPOSAL);
    const out = await agent.compare(THIN_VALUES, LEARNING_OFFERS);
    expect(out.modelVersion).toBe('offer-comparison@1.0.0');
  });

  it('reproducible: identical inputs → byte-identical comparisons across two calls', async () => {
    const { agent } = agentReturning(INVENTED_PERK_PROPOSAL);
    const a = await agent.compare(ONSITE_VALUES, ONSITE_OFFERS);
    const b = await agent.compare(ONSITE_VALUES, ONSITE_OFFERS);
    expect(a).toEqual(b);
  });

  it('fails closed on malformed model JSON (guardrail still emits a grounded comparison)', async () => {
    const provider = new FakeLlmProvider(() => ({
      text: 'not json',
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const gateway = createLlmGateway({
      provider,
      modelsByTier: { cheap: 'c', frontier: 'f' },
      pricing: {},
    });
    const agent = new LlmOfferComparisonAgent(gateway);
    const out = await agent.compare(THIN_VALUES, LEARNING_OFFERS);
    expect(out.weights).toEqual(THIN_VALUES.weights);
    expect([...out.ranking].sort()).toEqual(['o1', 'o2']);
    expect(out.explanation.length).toBeGreaterThan(0);
  });

  it('uses the FRONTIER tier (offer trade-offs are strategic reasoning per CLAUDE.md §3.6)', async () => {
    const { agent, provider } = agentReturning(INVENTED_PERK_PROPOSAL);
    await agent.compare(ONSITE_VALUES, ONSITE_OFFERS);
    expect(provider.calls[0]?.model).toBe('fixture-frontier');
  });
});

// ============================================================================
// RED-TEST: prove the guardrail is LOAD-BEARING. If we bypass
// groundOfferComparison and let `rawProposalToOfferComparison` compose the
// output directly from the raw proposal, every forbidden sin leaks — and the
// assertions above would flip.
// ============================================================================
describe('offer comparison — RED-TEST: neuter the guardrail → sins leak loudly', () => {
  it('INVENTED PERK: raw proposal renders "remote flexibility" verbatim', () => {
    const parsed = rawOfferComparisonProposalSchema.parse(INVENTED_PERK_PROPOSAL);
    const leaked = rawProposalToOfferComparison(parsed);
    expect(leaked.explanation.toLowerCase()).toContain('remote flexibility');
  });

  it('INVENTED WEIGHT: raw proposal keeps the invented "Kubernetes" weight key', () => {
    const parsed = rawOfferComparisonProposalSchema.parse(INVENTED_WEIGHT_PROPOSAL);
    const leaked = rawProposalToOfferComparison(parsed);
    expect(Object.keys(leaked.weights)).toContain('Kubernetes');
    expect(Object.keys(leaked.weights)).toContain('cloud certifications');
  });

  it('PHANTOM REF: raw proposal keeps the fabricated "o-fabricated" evidence ref', () => {
    const parsed = rawOfferComparisonProposalSchema.parse(PHANTOM_REF_PROPOSAL);
    const leaked = rawProposalToOfferComparison(parsed);
    expect(leaked.evidenceRefs).toContain('o-fabricated');
  });
});