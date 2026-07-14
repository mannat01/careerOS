/**
 * Fixture-backed Match Scorer — wraps the REAL LlmMatchScorerAgent
 * (@careeros/cie-resume) with a FakeLlmProvider that returns, for each golden
 * scoring case, an INTEGRITY-PROBE raw proposal: an over-scored, fabricated
 * explanation that credits the candidate with the exact demanded-but-missing
 * qualification the case forbids (a "distributed systems" claim on a barista
 * profile, a "senior engineering" claim on a nurse profile, etc.).
 *
 * The Step-2 lesson, applied from the start: the raw proposal actively commits
 * the sins the golden set forbids. The real agent's DETERMINISTIC guardrail
 * (io.ts `groundMatchScore`) DISCARDS the proposal's numbers/refs and RECOMPUTES
 * the honest score from the real facts vs the real requirements — dropping the
 * inflated overall, the fabricated evidenceRef, and the ungrounded explanation.
 * Only the network LLM call is faked; the full parse → ground pipeline runs for
 * real, so turning the gate green proves the guardrail, not a hand-fed answer.
 */
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { LlmMatchScorerAgent } from '@careeros/cie-resume';
import type { ProfileFact, ScoringAgent, ScoringCase } from './types.js';

/**
 * INTEGRITY PROBES — the concrete "pressure to fabricate" payloads the fake
 * model emits per case: an inflated `overall` (95 across the board), the
 * forbidden inflation string echoed into the explanation (so a neutered
 * guardrail would let it leak), and a FABRICATED evidenceRef ("f-fabricated")
 * so the structural provenance gate is exercised too. The real guardrail must
 * ignore all of it and emit an honest score grounded in the real fact ids.
 */
function buildIntegrityProbeJson(c: ScoringCase): string {
  const forbidden = c.forbidden?.[0] ?? 'strong match on every stated requirement';
  return JSON.stringify({
    overall: 95,
    subscores: [
      { key: 'skills_match', value: 95 },
      { key: 'experience_relevance', value: 95 },
      { key: 'seniority_fit', value: 95 },
    ],
    explanation:
      `Overall match 95/100 for ${c.job.title}. ` +
      `The candidate is a ${forbidden}. ` +
      `Full coverage of every stated requirement; no gaps.`,
    // Real fact id + a FABRICATED one — the structural provenance gate must strip it.
    evidenceRefs: [...(c.profile[0] ? [c.profile[0].id] : []), 'f-fabricated'],
  });
}

/** True when every fact summary of `c` appears in the prompt text. */
function caseMatchesPrompt(c: ScoringCase, promptText: string): boolean {
  return c.profile.every((f: ProfileFact) => promptText.includes(f.summary));
}

export function createScoringFixtureAgent(cases: ScoringCase[]): ScoringAgent {
  const fakeProvider = new FakeLlmProvider((req) => {
    const promptText = req.messages.map((m) => m.content).join('\n');
    // Most-facts-first so a sparse profile never shadows a richer superset.
    const ordered = [...cases].sort((a, b) => b.profile.length - a.profile.length);
    const hit = ordered.find((c) => caseMatchesPrompt(c, promptText));
    const json = hit
      ? buildIntegrityProbeJson(hit)
      : JSON.stringify({ overall: 0, subscores: [], explanation: '', evidenceRefs: [] });
    return { text: json, usage: { inputTokens: 100, outputTokens: json.length } };
  });

  const gateway = createLlmGateway({
    provider: fakeProvider,
    modelsByTier: { cheap: 'fixture-model', frontier: 'fixture-model' },
    pricing: {},
  });

  // The REAL Scorer/Explainer agent — full parse → groundMatchScore pipeline.
  // The eval-side and pkg-side ScoringAgent interfaces are STRUCTURALLY
  // IDENTICAL (both take ProfileFact/TailorProfileFact with the same shape and
  // JobDescription with the same shape), so TypeScript accepts the instance
  // directly — no adapter, no casts.
  return new LlmMatchScorerAgent(gateway);
}
