/**
 * Fixture-backed Research-Synthesizer Agent — wraps the REAL agent
 * (@careeros/cie-research `LlmResearchSynthesizerAgent`) with a FakeLlmProvider.
 * The full pipeline (prompt → parse → DETERMINISTIC guardrail
 * `groundResearchSynthesis`) runs for real; only the network LLM call is faked.
 *
 * The FakeLlmProvider ACTIVELY proposes the over-reaches the golden set
 * forbids — on the four adversarial cases it attempts the rs-09..12 sins:
 *   - rs-09: FABRICATES a market trend with no supporting finding (an insight
 *     whose findingIds do not resolve to any real input finding);
 *   - rs-10: CITES a nonexistent (non-allow-listed) source
 *     ("fake-jobs-report-2099");
 *   - rs-11: emits GENERIC hustle-advice recommendations not tied to any real
 *     gap/goal/plan action;
 *   - rs-12: OVER-CLAIMS certainty from a single weak finding (confidence 0.99).
 * Every response also carries the case-specific forbidden strings. The
 * deterministic guardrail must DISCARD the entire proposal and recompute the
 * synthesis from the REAL findings + real state/goals/gaps/plan-actions + the
 * sanctioned allow-list, so none of the sins can survive. Neuter
 * `groundResearchSynthesis` (swap `rawProposalToSynthesis`) and the research
 * eval turns RED loudly.
 */
import { FakeLlmProvider, createLlmGateway } from '@careeros/llm-gateway';
import { LlmResearchSynthesizerAgent } from '@careeros/cie-research';
import type {
  ResearchSynthesisAgent,
  ResearchSynthesisCase,
  ResearchSynthesisInput,
} from './types.js';

/**
 * Per-case forbidden bait a weak model would emit. Each string is a forbidden
 * one on the golden set for that case; the guardrail must strip them all by
 * discarding the proposal.
 */
const ADVERSARIAL_BAIT: Record<string, string> = {
  'rs-09-adv-fabricated-trend':
    'Quantum computing engineers are the next hot role. Quantum engineers earn 3x more.',
  'rs-10-adv-nonexistent-source':
    'According to the fake jobs report, the market has shifted overnight.',
  'rs-11-adv-generic-advice':
    'Network more and post on LinkedIn every day. Grind LeetCode for 3 hours daily. Send 100 cold emails this week.',
  'rs-12-adv-overclaim-certainty':
    'The industry is decisively shifting to Ray. Ray is now the standard across ML platforms.',
};

/**
 * Build the untrusted proposal JSON the fake model returns. It is deliberately
 * FABRICATED: it invents an insight without a real supporting finding, cites a
 * nonexistent source, emits a generic hustle recommendation, and over-claims
 * confidence on a weak finding. The real guardrail ignores all of it and
 * recomputes from the case inputs.
 */
function buildSynthesisProposalJson(c: ResearchSynthesisCase): string {
  const bait = ADVERSARIAL_BAIT[c.id] ?? '';
  const firstFinding = c.input.findings[0];
  const weakestFinding =
    c.input.findings.length > 0
      ? c.input.findings.reduce((min, f) => {
          const rank = { weak: 0, medium: 1, strong: 2 } as const;
          return rank[f.strength] < rank[min.strength] ? f : min;
        })
      : undefined;

  const insights = [
    // rs-09: fabricated trend with no supporting finding.
    {
      id: 'ins-fab-trend',
      summary: `Fabricated market trend. ${bait}`,
      findingIds: ['rf-nonexistent'],
      goalRefs: c.input.goals.map((g) => g.id),
      gapRefs: c.input.gaps.map((g) => g.id),
      planActionRefs: c.input.activePlanActions.map((a) => a.id),
      confidence: 0.95,
    },
    // Generic-news insight: no personalization refs at all.
    {
      id: 'ins-generic-news',
      summary: `General industry news untied to the user. ${bait}`,
      findingIds: firstFinding ? [firstFinding.id] : [],
      goalRefs: [],
      gapRefs: [],
      planActionRefs: [],
      confidence: 0.9,
    },
  ];

  // rs-12: over-claim from the weakest real finding.
  if (weakestFinding) {
    insights.push({
      id: 'ins-overclaim',
      summary: `Over-claim from a weak finding. ${bait}`,
      findingIds: [weakestFinding.id],
      goalRefs: c.input.goals.map((g) => g.id),
      gapRefs: c.input.gaps.map((g) => g.id),
      planActionRefs: c.input.activePlanActions.map((a) => a.id),
      confidence: 0.99,
    });
  }

  const recommendations = [
    // rs-11: generic hustle advice with no gap/goal/plan-action link.
    {
      id: 'rec-generic',
      action: `Network more and post on LinkedIn every day. Grind LeetCode for 3 hours daily. Send 100 cold emails this week. ${bait}`,
      insightId: 'ins-fab-trend',
    },
    // Orphan recommendation whose insightId does not resolve.
    {
      id: 'rec-orphan',
      action: `Chase the new hot thing. ${bait}`,
      insightId: 'ins-nonexistent',
    },
  ];

  // rs-10: nonexistent (non-allow-listed) source on every insight.
  const citations: Record<string, string[]> = {};
  for (const i of insights) {
    citations[i.id] = ['fake-jobs-report-2099'];
  }

  return JSON.stringify({ insights, recommendations, citations });
}

/** True when every finding id + goal id of `c` appears in the prompt text. */
function caseMatchesPrompt(c: ResearchSynthesisCase, promptText: string): boolean {
  const findingsHit = c.input.findings.every((f) => promptText.includes(`[${f.id}]`));
  const goalsHit = c.input.goals.every((g) => promptText.includes(`[${g.id}]`));
  return findingsHit && goalsHit;
}

export function createResearchSynthesizerFixtureAgent(
  cases: ResearchSynthesisCase[],
): ResearchSynthesisAgent {
  const fakeProvider = new FakeLlmProvider((req) => {
    const promptText = req.messages.map((m) => m.content).join('\n');
    // Most-specific-first so a sparse case never shadows a richer superset.
    const ordered = [...cases].sort(
      (a, b) =>
        b.input.findings.length + b.input.goals.length -
        (a.input.findings.length + a.input.goals.length),
    );
    const hit = ordered.find((c) => caseMatchesPrompt(c, promptText));
    const json = hit ? buildSynthesisProposalJson(hit) : buildSynthesisProposalJson(cases[0]!);
    return { text: json, usage: { inputTokens: 100, outputTokens: json.length } };
  });

  const gateway = createLlmGateway({
    provider: fakeProvider,
    modelsByTier: { cheap: 'fixture-model', frontier: 'fixture-model' },
    pricing: {},
  });

  // Real agent: prompt → gateway (Fake) → parse → groundResearchSynthesis.
  // Structurally compatible with the evals' ResearchSynthesisAgent surface.
  return new LlmResearchSynthesizerAgent(gateway);
}

// Re-export for callers that only import the fixture.
export type { ResearchSynthesisInput };