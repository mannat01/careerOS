/**
 * Fixture-backed Offer-Comparison Agent — wraps the REAL OfferComparisonAgent
 * (@careeros/cie-reasoning `LlmOfferComparisonAgent`) with a FakeLlmProvider.
 * The full pipeline (prompt → parse → DETERMINISTIC guardrail) runs for real;
 * only the network LLM call is faked.
 *
 * The FakeLlmProvider ACTIVELY proposes the over-reaches the golden set
 * forbids — for the three adversarial cases it:
 *   - INVENTS a perk that does not exist in the offers (oc-02: "remote
 *     flexibility" when both offers explicitly say onsite);
 *   - INVENTS a weight key for a preference the user never stated (oc-03: adds
 *     "Kubernetes"/"cloud certifications" weight from vague "learning
 *     opportunities");
 *   - PAPERS OVER a values conflict (oc-04: fabricates "flexible hours" /
 *     "sustainable pace" that the offer text does not offer).
 * All three ALSO emit a PHANTOM evidence ref (e.g. "o3-fabricated").
 * The guardrail must drop each. Neuter `groundOfferComparison` (swap
 * `rawProposalToOfferComparison`) and the offers eval turns RED loudly.
 */
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { LlmOfferComparisonAgent } from '@careeros/cie-reasoning';
import type { OfferComparisonAgent, OfferComparisonCase } from './types.js';

interface RawOfferProposal {
  ranking: string[];
  weights: Record<string, number>;
  explanation: string;
  evidenceRefs: string[];
}

/**
 * ACTIVE FABRICATIONS — the forbidden content a weak model emits per
 * adversarial case. Each attempts a distinct sin: invented perk, invented
 * weight key, invented offer id. Guardrail must drop each; neuter it and
 * every one leaks.
 */
const ACTIVE_FABRICATIONS: Record<string, Partial<RawOfferProposal>> = {
  // oc-02: invent a remote perk both offers explicitly lack + phantom ref.
  'oc-02-adversarial-fabrication': {
    explanation:
      'CityBank offers a hybrid arrangement with occasional work from home options and remote flexibility, making it slightly better on remote work.',
    ranking: ['o1', 'o2'],
    evidenceRefs: ['o1', 'o2', 'o3-fabricated'],
  },
  // oc-03: invent weight keys ("Kubernetes", "cloud certifications") the user
  // never stated + phantom ref.
  'oc-03-thin-evidence': {
    explanation:
      'InnovateAI aligns with Kubernetes and cloud certifications preferences, plus specific technologies exposure.',
    weights: {
      'learning opportunities': 0.4,
      'good team': 0.3,
      Kubernetes: 0.2,
      'cloud certifications': 0.1,
    },
    evidenceRefs: ['o1', 'o2', 'o3-fabricated'],
  },
  // oc-04: paper over the WLB conflict by inventing "flexible hours" / "no
  // weekend work" that StartupX does not offer.
  'oc-04-values-conflict': {
    explanation:
      'StartupX actually provides flexible hours and a reasonable schedule with good work-life balance and no weekend work, offering a sustainable pace.',
    ranking: ['o1', 'o2'],
    evidenceRefs: ['o1', 'o2', 'o3-fabricated'],
  },
};

/** Honest proposal straight from the answer key (what a good model emits). */
function honestProposal(c: OfferComparisonCase): RawOfferProposal {
  return {
    ranking: [...c.expected.ranking],
    weights: { ...c.expected.weights },
    explanation: c.expected.explanation,
    evidenceRefs: [...c.expected.evidenceRefs],
  };
}

/**
 * Raw JSON the fake model emits: honest grounded proposal PLUS the active
 * fabrications (adversarial only). The guardrail's job is to recompute the
 * output from real inputs and discard the proposal entirely.
 */
export function buildOfferProposalJson(c: OfferComparisonCase): string {
  const base = honestProposal(c);
  const fabricated = ACTIVE_FABRICATIONS[c.id] ?? {};
  const proposal = { ...base, ...fabricated };
  return JSON.stringify(proposal);
}

/** True when every offer id + user weight key of `c` appears in the prompt text. */
function caseMatchesPrompt(c: OfferComparisonCase, promptText: string): boolean {
  const idsHit = c.offers.every((o) => promptText.includes(`[${o.id}]`));
  const weightsHit = Object.keys(c.candidateValues.weights).every((k) =>
    promptText.includes(`- ${k}:`),
  );
  return idsHit && weightsHit;
}

export function createOfferFixtureAgent(cases: OfferComparisonCase[]): OfferComparisonAgent {
  const fakeProvider = new FakeLlmProvider((req) => {
    const promptText = req.messages.map((m) => m.content).join('\n');
    // Most-offers-first so a sparse case never shadows a richer superset.
    const ordered = [...cases].sort((a, b) => b.offers.length - a.offers.length);
    const hit = ordered.find((c) => caseMatchesPrompt(c, promptText));
    const json = hit
      ? buildOfferProposalJson(hit)
      : JSON.stringify(honestProposal(cases[0]!));
    return { text: json, usage: { inputTokens: 100, outputTokens: json.length } };
  });

  const gateway = createLlmGateway({
    provider: fakeProvider,
    modelsByTier: { cheap: 'fixture-model', frontier: 'fixture-model' },
    pricing: {},
  });

  // Real agent: prompt → gateway (Fake) → parse → groundOfferComparison.
  // Structurally compatible with the evals' OfferComparisonAgent surface.
  return new LlmOfferComparisonAgent(gateway) satisfies OfferComparisonAgent;
}