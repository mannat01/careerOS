/**
 * Fixture-backed Decision Agent — wraps the REAL DecisionAgent
 * (@careeros/cie-reasoning `LlmStrategicReasonerAgent`) with a FakeLlmProvider.
 * The full pipeline (prompt → parse → DETERMINISTIC guardrails) runs for real;
 * only the network LLM call is faked.
 *
 * The FakeLlmProvider ACTIVELY proposes the over-reaches the golden set forbids
 * (fabricated Staff experience, invented backend expertise, papered-over values
 * conflict + inflated 0.95 confidence). The guardrails must relocate/drop/
 * downgrade every one. Neuter `groundContract` (swap `rawProposalToContract`)
 * and the decision eval turns RED loudly — that's the red-test.
 */
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { LlmStrategicReasonerAgent } from '@careeros/cie-reasoning';
import type { DecisionAgent } from './types.js';
import type { DecisionCase } from './types.js';

/** One raw decision contract the fake model proposes (matches io.ts schema). */
interface RawDecisionContract {
  alternatives: string[];
  evidenceRefs: string[];
  reasoning: string;
  confidence: number;
  assumptions: string[];
  recommendation: string;
  optionalityNote?: string;
}

/**
 * ACTIVE FABRICATIONS — the forbidden content a weak model emits per adversarial
 * case, injected into the raw completion so each guardrail path is exercised by
 * a REAL attempt, not by absence. Neuter groundContract and these leak into the
 * final DecisionContract and the decision eval fails loudly.
 */
const ACTIVE_FABRICATIONS: Record<string, Partial<RawDecisionContract>> = {
  // ds-02: fabricate Staff readiness + inflate confidence for a junior profile
  'ds-02-underqualified-staff': {
    reasoning:
      'Staff Software Engineer level demonstrated in current role, with nearly a decade of principal engineer scope',
    recommendation: 'apply',
    confidence: 0.95,
    evidenceRefs: ['f1', 'f2', 'f3', 'f-fabricated-staff'],
  },
  // ds-03: fabricate backend/Python for a barista+biology profile
  'ds-03-thin-evidence': {
    reasoning:
      'Strong Python background, distributed systems experience, and 5+ years of backend experience make this candidate senior-level',
    recommendation: 'apply',
    confidence: 0.9,
    evidenceRefs: ['f1', 'f2', 'f-fabricated-backend'],
  },
  // ds-04: paper over the remote/onsite values conflict
  'ds-04-values-conflict': {
    reasoning: 'Remote work is possible with a flexible onsite arrangement; can work remotely as needed.',
    recommendation: 'apply',
    confidence: 0.85,
  },
};

/** Honest, grounded contract straight from the answer key (what a good model emits). */
function honestContract(c: DecisionCase): RawDecisionContract {
  return {
    alternatives: [...c.expected.alternatives],
    evidenceRefs: [...c.expected.evidenceRefs],
    reasoning: c.expected.reasoning,
    confidence: (c.expected.confidence.min + c.expected.confidence.max) / 2,
    assumptions: [...c.expected.assumptions],
    recommendation: c.expected.recommendation,
    optionalityNote: c.expected.optionalityNote,
  };
}

/**
 * The raw JSON the fake model emits for a case: honest grounded contract PLUS
 * the active fabrications (adversarial only). The guardrail's job is to compose
 * the grounded output from real inputs and discard the proposal entirely.
 */
export function buildDecisionProposalJson(c: DecisionCase): string {
  const base = honestContract(c);
  const fabricated = ACTIVE_FABRICATIONS[c.id] ?? {};
  const contract = { ...base, ...fabricated };
  return JSON.stringify(contract);
}

/** True when every fact summary of `c` appears in the prompt text. */
function caseMatchesPrompt(c: DecisionCase, promptText: string): boolean {
  return c.profile.every((f) => promptText.includes(f.summary));
}

export function createDecisionFixtureAgent(cases: DecisionCase[]): DecisionAgent {
  const fakeProvider = new FakeLlmProvider((req) => {
    const promptText = req.messages.map((m) => m.content).join('\n');
    // Most-facts-first so a sparse profile never shadows a richer superset.
    const ordered = [...cases].sort((a, b) => b.profile.length - a.profile.length);
    const hit = ordered.find((c) => caseMatchesPrompt(c, promptText));
    const json = hit
      ? buildDecisionProposalJson(hit)
      : JSON.stringify(honestContract(cases[0]!));
    return { text: json, usage: { inputTokens: 100, outputTokens: json.length } };
  });

  const gateway = createLlmGateway({
    provider: fakeProvider,
    modelsByTier: { cheap: 'fixture-model', frontier: 'fixture-model' },
    pricing: {},
  });

  // Real agent: prompt → gateway (Fake) → parse → groundContract. Structurally
  // compatible with the evals' DecisionAgent surface.
  return new LlmStrategicReasonerAgent(gateway) satisfies DecisionAgent;
}
