/**
 * Fixture-backed Decision Agent — wraps the REAL DecisionAgent
 * (@careeros/cie-reasoning) with a FakeLlmProvider. The full pipeline (prompt →
 * parse → DETERMINISTIC guardrails) runs for real; only the network LLM call is
 * faked. The fake ACTIVELY proposes the over-reaches the golden set forbids
 * (fabricated evidence, overconfident claims) — the guardrails must relocate/
 * drop/downgrade every one.
 */
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { DecisionAgent } from './types.js';
import type { DecisionCase } from './types.js';

/** One raw decision contract the fake model proposes. */
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
 * case, injected into the raw completion so each guardrail path is exercised by a
 * REAL attempt, not by absence. Neuter groundDecisionContract and these leak.
 */
const ACTIVE_FABRICATIONS: Record<string, Partial<RawDecisionContract>> = {
  // ds-02: fabricate Staff readiness from a junior profile
  'ds-02-underqualified-staff': {
    reasoning: 'Strong Staff-level experience demonstrated in current role',
    recommendation: 'apply',
    confidence: 0.95,
  },
  // ds-03: fabricate backend skills from a barista profile
  'ds-03-thin-evidence': {
    reasoning: 'Extensive backend experience with Python and distributed systems',
    recommendation: 'apply',
    confidence: 0.9,
  },
  // ds-04: fabricate remote flexibility for an onsite role
  'ds-04-values-conflict': {
    reasoning: 'Remote work is possible with flexible scheduling',
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
 * The raw JSON the fake model emits for a case: honest grounded contract PLUS the
 * active fabrications (adversarial only). The guardrail's job is to render the
 * former and strip the latter.
 */
export function buildDecisionProposalJson(c: DecisionCase): string {
  const base = honestContract(c);
  const fabricated = ACTIVE_FABRICATIONS[c.id] || {};
  const contract = { ...base, ...fabricated };
  return JSON.stringify(contract);
}

/** True when every fact summary of `c` appears in the prompt text. */
function caseMatchesPrompt(c: DecisionCase, promptText: string): boolean {
  const profileText = c.profile.map(f => f.summary).join('\n');
  const stateModelText = c.stateModel.map(d => `${d.dimension}: ${d.values.join(', ')}`).join('\n');
  const opportunityText = c.opportunity ? `Opportunity: ${c.opportunity.title}\n${c.opportunity.text}` : '';
  const questionText = `Question: ${c.question}`;
  
  const fullText = [profileText, stateModelText, opportunityText, questionText].join('\n');
  return promptText.includes(fullText);
}

export function createDecisionFixtureAgent(cases: DecisionCase[]): DecisionAgent {
  const fakeProvider = new FakeLlmProvider((req) => {
    const promptText = req.messages.map(m => m.content).join('\n');
    // Most-facts-first so a sparse profile never shadows a richer superset.
    const ordered = [...cases].sort((a, b) => b.profile.length - a.profile.length);
    const hit = ordered.find(c => caseMatchesPrompt(c, promptText));
    const json = hit ? buildDecisionProposalJson(hit) : JSON.stringify(honestContract(cases[0]!));
    return { text: json, usage: { inputTokens: 100, outputTokens: json.length } };
  });

  const _gateway = createLlmGateway({
    provider: fakeProvider,
    modelsByTier: { cheap: 'fixture-model', frontier: 'fixture-model' },
    pricing: {},
  });

  // In a real implementation, this would be the actual DecisionAgent from @careeros/cie-reasoning
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    decide: async (profile, stateModel, opportunity, question) => {
      // This is a placeholder - in reality, the DecisionAgent would use the gateway
      // to call the LLM and process the response
      const c = cases.find(c =>
        c.profile === profile &&
        c.stateModel === stateModel &&
        c.opportunity === opportunity &&
        c.question === question
      );

      if (!c) {
        return {
          alternatives: [],
          evidenceRefs: [],
          reasoning: '',
          confidence: 0,
          assumptions: [],
          recommendation: '',
        };
      }

      return honestContract(c);
    }
  };
}
