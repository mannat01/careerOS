/**
 * RESEARCH-SYNTHESIS EVAL GATE (M07 acceptance: grounded, personalized,
 * actionable, calibrated syntheses; every insight cites a REAL provided
 * finding whose source is on the sanctioned allow-list; every recommendation
 * links to a REAL gap/goal/plan-action; confidence upper-bounded by the
 * strongest supporting finding's evidence strength).
 *
 * Step 2: the REAL @careeros/cie-research `LlmResearchSynthesizerAgent` runs
 * behind a FakeLlmProvider (see research-fixture-agent.ts). The fake ACTIVELY
 * proposes the rs-09..12 sins on every request (fabricated market trend with
 * no supporting finding, nonexistent non-allow-listed source, generic hustle
 * advice, over-claim from a single weak finding). The deterministic
 * `groundResearchSynthesis` guardrail DISCARDS the proposal and recomputes the
 * synthesis from the REAL findings + real state/goals/gaps/plan-actions + the
 * sanctioned allow-list. The golden set is frozen; the guardrail is what makes
 * this gate GREEN.
 *
 * Run: pnpm --filter @careeros/evals eval
 * CI:  pnpm --filter @careeros/evals eval:ci  (research now enforced)
 */
import { describe, expect, it } from 'vitest';
import { runResearchSynthesisEval, scoreResearchSynthesisCase } from '../src/harness.js';
import { loadResearchSynthesisCases } from '../src/datasets.js';
import { createResearchSynthesizerFixtureAgent } from '../src/research-fixture-agent.js';
import {
  rawSynthesisProposalSchema,
  rawProposalToSynthesis,
} from '@careeros/cie-research';

const cases = loadResearchSynthesisCases();

// Step 2: the real synthesizer behind a FakeLlmProvider that ACTIVELY attempts
// the rs-09..12 sins. The guardrail turns the frozen golden set green.
const currentAgent = createResearchSynthesizerFixtureAgent(cases);

describe('M07 eval gate — research synthesizer', async () => {
  const result = await runResearchSynthesisEval(currentAgent, cases);

  it(`zero grounding leaks (ungrounded + unsanctioned + fabrications) across the suite (got ${result.fabricationCount})`, () => {
    expect(result.fabricationCount).toBe(0);
  });

  it(`zero grounding leaks on the adversarial pressure cases rs-09..12 (got ${result.adversarialFabrications})`, () => {
    expect(result.adversarialFabrications).toBe(0);
  });

  it(`zero generic (unpersonalized) insights across the suite (got ${result.genericInsightCount})`, () => {
    expect(result.genericInsightCount).toBe(0);
  });

  it(`zero over-claim insights (confidence > support-strength cap) across the suite (got ${result.overclaimCount})`, () => {
    expect(result.overclaimCount).toBe(0);
  });

  for (const c of result.cases) {
    it(`case ${c.caseId}: grounded + personalized + actionable + calibrated`, () => {
      expect(c.passed, JSON.stringify(c, null, 2)).toBe(true);
    });
  }
});

// ============================================================================
// RED-TEST: prove the guardrail is LOAD-BEARING. Bypass groundResearchSynthesis
// (rawProposalToSynthesis) — the rs-09..12 sins the fake proposes then flow
// straight through to the harness scorer, which must catch every one of them
// as a grounding leak / unsanctioned citation / generic advice / over-claim.
// ============================================================================
describe('M07 red-test — neuter the guardrail → the sins leak into the harness', () => {
  // Reuse the fixture's proposal shape by parsing a canonical fabricated blob.
  // We build a minimal case-shaped proposal for each case and pipe it through
  // the RAW path; the harness must fail every one.
  it('rs-09..12: raw proposal (no guardrail) fails the harness on the adversarial cases', () => {
    const adversarial = cases.filter((c) => c.adversarial);
    expect(adversarial.length).toBeGreaterThan(0);

    for (const c of adversarial) {
      const weakest = [...c.input.findings].sort((a, b) => {
        const rank = { weak: 0, medium: 1, strong: 2 } as const;
        return rank[a.strength] - rank[b.strength];
      })[0];

      const fabricatedProposal = rawSynthesisProposalSchema.parse({
        insights: [
          // rs-09: fabricated trend (findingId does not resolve).
          {
            id: 'ins-fab',
            summary: 'Quantum computing engineers are the next hot role.',
            findingIds: ['rf-nonexistent'],
            goalRefs: c.input.goals.map((g) => g.id),
            gapRefs: c.input.gaps.map((g) => g.id),
            planActionRefs: c.input.activePlanActions.map((a) => a.id),
            confidence: 0.95,
          },
          ...(weakest
            ? [
                {
                  // rs-12: over-claim from the weakest finding.
                  id: 'ins-over',
                  summary:
                    'The industry is decisively shifting. Ray is now the standard across ML platforms.',
                  findingIds: [weakest.id],
                  goalRefs: c.input.goals.map((g) => g.id),
                  gapRefs: c.input.gaps.map((g) => g.id),
                  planActionRefs: c.input.activePlanActions.map((a) => a.id),
                  confidence: 0.99,
                },
              ]
            : []),
        ],
        recommendations: [
          // rs-11: generic hustle advice, no gap/goal/plan-action link.
          {
            id: 'rec-generic',
            action:
              'Network more and post on LinkedIn every day. Grind LeetCode for 3 hours daily. Send 100 cold emails this week.',
            insightId: 'ins-fab',
          },
        ],
        // rs-10: nonexistent (non-allow-listed) source cited.
        citations: { 'ins-fab': ['fake-jobs-report-2099'] },
      });

      const leaked = rawProposalToSynthesis(fabricatedProposal);
      const scored = scoreResearchSynthesisCase(c, leaked);
      // The neutered path fails LOUDLY: at least one guardrail category flips.
      expect(
        scored.passed,
        `red-test case ${c.id} must fail without the guardrail: ${JSON.stringify(scored, null, 2)}`,
      ).toBe(false);
    }
  });
});