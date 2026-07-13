/**
 * Fixture-backed StateUpdater agent — wraps the REAL LlmStateUpdaterAgent
 * (@careeros/cie-state) with a FakeLlmProvider that returns, for each golden
 * state-model case, a PLAUSIBLE RAW proposal (not the final answer): the honest
 * grounded dimension values derived from the answer key PLUS the exact
 * OVER-REACHES a weak model would assert (ACTIVE_OVERREACHES below).
 *
 * The Step-2 lesson, applied from the start: the raw proposal actively commits
 * the sins the golden set forbids —
 *   - a DEMONSTRATED "distributed systems" inferred from Kubernetes (sm-05),
 *   - a DEMONSTRATED "Tableau" from a merely-listed skill (sm-06),
 *   - an OHIO geographic preference invented from a state license (sm-07),
 *   - a "people management" readiness claim with no management fact (sm-08),
 *   - a value citing PHANTOM evidence that resolves to nothing,
 *   - confident claims on a THIN new-grad profile (sm-02).
 * The real agent's DETERMINISTIC guardrails (io.ts applyGuardrails) must
 * relocate / drop / downgrade every one of them. Only the network LLM call is
 * faked; the full parse → guardrail pipeline runs for real.
 */
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { LlmStateUpdaterAgent } from '@careeros/cie-state';
import type { StateModelAgent } from '@careeros/cie-state';
import type { ProfileFact, StateModelCase } from './types.js';

/** One raw value the fake model proposes, tagged with its target dimension. */
interface RawProposalValue {
  dimension: string;
  text: string;
  evidenceRefs: string[];
  provenance: 'demonstrated' | 'inferred' | 'summarized';
}

/**
 * ACTIVE OVER-REACHES — the forbidden assertions a weak model emits per case,
 * injected into the raw completion so each guardrail is exercised by a REAL
 * attempt, not by absence. Neuter the matching guardrail in io.ts and the
 * corresponding value leaks into the agent's output (red-tested).
 */
export const ACTIVE_OVERREACHES: Record<string, RawProposalValue[]> = {
  // Thin profile: assert confident, fabricated claims a barista/bio-grad can't back.
  'sm-02-new-grad-thin-evidence': [
    { dimension: 'demonstrated_skills', text: 'team leadership', evidenceRefs: ['f1'], provenance: 'demonstrated' },
    { dimension: 'career_goals', text: 'research scientist', evidenceRefs: ['f2'], provenance: 'summarized' },
    { dimension: 'strengths', text: 'laboratory experience', evidenceRefs: ['f2'], provenance: 'summarized' },
  ],
  // Short dev tenure: assert seniority/engineering-management readiness.
  'sm-03-career-changer-pivot': [
    { dimension: 'leadership_readiness', text: 'engineering management', evidenceRefs: ['f1'], provenance: 'summarized' },
  ],
  // Adjacency: assert a DEMONSTRATED "distributed systems" from Kubernetes.
  'sm-05-inferred-vs-demonstrated-adjacency': [
    { dimension: 'demonstrated_skills', text: 'distributed systems', evidenceRefs: ['f2'], provenance: 'demonstrated' },
    { dimension: 'demonstrated_skills', text: 'cloud architecture', evidenceRefs: ['f2'], provenance: 'demonstrated' },
  ],
  // Listed-only skill: assert a DEMONSTRATED "Tableau" from a claimed-only fact.
  'sm-06-claimed-skill-stays-inferred': [
    { dimension: 'demonstrated_skills', text: 'Tableau', evidenceRefs: ['f3'], provenance: 'demonstrated' },
  ],
  // Zero-signal: invent an Ohio location preference + a comp target from nothing.
  'sm-07-no-ungrounded-dimensions': [
    { dimension: 'geographic_preferences', text: 'Ohio', evidenceRefs: ['f2'], provenance: 'inferred' },
    { dimension: 'compensation_goals', text: '$150k', evidenceRefs: ['f1'], provenance: 'summarized' },
  ],
  // No management fact: assert a "people management" readiness + a PHANTOM-evidence value.
  'sm-08-evidence-links-required': [
    { dimension: 'leadership_readiness', text: 'people management', evidenceRefs: ['f1'], provenance: 'summarized' },
    { dimension: 'strengths', text: 'visionary leadership', evidenceRefs: ['f99'], provenance: 'summarized' },
  ],
};

/** Honest, grounded values straight from the answer key (what a good model emits). */
function honestValues(c: StateModelCase): RawProposalValue[] {
  const out: RawProposalValue[] = [];
  for (const exp of c.expected) {
    const provenance =
      exp.dimension === 'demonstrated_skills'
        ? 'demonstrated'
        : exp.dimension === 'inferred_skills'
          ? 'inferred'
          : 'summarized';
    for (const text of exp.mustInclude) {
      out.push({ dimension: exp.dimension, text, evidenceRefs: exp.evidenceRefs, provenance });
    }
  }
  return out;
}

/**
 * The raw JSON the fake model emits for a case: honest grounded values PLUS the
 * active over-reaches. Exported so the eval can assert the over-reaches really
 * are proposed (the forbidden gate is then proven by their ABSENCE from output).
 */
export function buildStateProposalJson(c: StateModelCase): string {
  const all = [...honestValues(c), ...(ACTIVE_OVERREACHES[c.id] ?? [])];
  const byDim = new Map<string, Array<{ text: string; evidenceRefs: string[]; provenance: string }>>();
  for (const v of all) {
    const list = byDim.get(v.dimension) ?? [];
    list.push({ text: v.text, evidenceRefs: v.evidenceRefs, provenance: v.provenance });
    byDim.set(v.dimension, list);
  }
  const dimensions = [...byDim.entries()].map(([dimension, values]) => ({ dimension, values }));
  return JSON.stringify({ dimensions });
}

/** True when every fact summary of `c` appears in the prompt text. */
function caseMatchesPrompt(c: StateModelCase, promptText: string): boolean {
  return c.profile.every((f: ProfileFact) => promptText.includes(f.summary));
}

export function createStateFixtureAgent(cases: StateModelCase[]): StateModelAgent {
  const fakeProvider = new FakeLlmProvider((req) => {
    const promptText = req.messages.map((m) => m.content).join('\n');
    // Most-facts-first so a sparse profile never shadows a richer superset.
    const ordered = [...cases].sort((a, b) => b.profile.length - a.profile.length);
    const hit = ordered.find((c) => caseMatchesPrompt(c, promptText));
    const json = hit ? buildStateProposalJson(hit) : '{"dimensions":[]}';
    return { text: json, usage: { inputTokens: 100, outputTokens: json.length } };
  });

  const gateway = createLlmGateway({
    provider: fakeProvider,
    modelsByTier: { cheap: 'fixture-model', frontier: 'fixture-model' },
    pricing: {},
  });

  return new LlmStateUpdaterAgent(gateway);
}
