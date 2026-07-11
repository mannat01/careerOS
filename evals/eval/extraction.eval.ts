/**
 * EXTRACTION EVAL GATE (M02 acceptance: ≥90% recall per case, full provenance,
 * zero fabrication). Runs the CURRENT extraction agent against the golden set.
 *
 * Today the current agent is the deliberate stub → this gate is RED. Step 2
 * swaps in the real extractor (behind FakeLlmProvider) and must turn it green.
 * Run: pnpm --filter @careeros/evals eval   (NOT part of `pnpm -w test`)
 */
import { describe, expect, it } from 'vitest';
import { runExtractionEval } from '../src/harness.js';
import { loadExtractionCases } from '../src/datasets.js';
import { ACTIVE_CHEATS, buildFixtureJson, createFixtureAgent } from '../src/fixture-agent.js';

// Step 2: the REAL extraction agent (packages/agents) behind FakeLlmProvider.
// The full pipeline (sanitize → prompt → parse → deterministic post-parse +
// provenance grounding) runs for real; only the network LLM call is faked.
const cases = loadExtractionCases();
const currentAgent = createFixtureAgent(cases);


describe('M02 eval gate — resume extraction', async () => {
  const result = await runExtractionEval(currentAgent, loadExtractionCases());

  it(`overall recall ≥90% (got ${(result.overallRecall * 100).toFixed(1)}%)`, () => {
    expect(result.overallRecall).toBeGreaterThanOrEqual(0.9);
  });

  it(`zero fabricated facts (got ${result.fabricationCount})`, () => {
    expect(result.fabricationCount).toBe(0);
  });

  for (const c of result.cases) {
    it(`case ${c.caseId}: recall ${(c.recall * 100).toFixed(0)}%, provenance ok, no fabrication`, () => {
      expect(c.passed, JSON.stringify(c, null, 2)).toBe(true);
    });
  }
});

/**
 * ACTIVE-CHEAT integrity: prove the forbidden gate is exercised by a REAL
 * fabrication attempt, not by the fake simply never proposing the inflation.
 * For each adversarial case we assert BOTH halves:
 *   (a) the raw model completion the fake emits DOES contain every forbidden
 *       inflation (the cheat was actually proposed), and
 *   (b) the agent's OUTPUT contains NONE of them (the deterministic filter
 *       stripped them) and still hits full recall on the honest entities.
 * Delete the field/quote grounding in packages/agents io.ts and (b) goes red.
 */
describe('M02 fabrication guardrail — active-cheat probes (ext-13/14/15)', () => {
  const adversarial = cases.filter((c) => c.format === 'adversarial');

  it('covers all three adversarial cases with active cheats', () => {
    expect(adversarial.map((c) => c.id).sort()).toEqual([
      'ext-13-adv-aws-familiarity',
      'ext-14-adv-exposure-to-leadership',
      'ext-15-adv-team-credit-and-award',
    ]);
    for (const c of adversarial) {
      expect((ACTIVE_CHEATS[c.id] ?? []).length, `cheats defined for ${c.id}`).toBeGreaterThan(0);
    }
  });

  for (const c of adversarial) {
    const forbidden = c.forbidden ?? [];

    it(`${c.id}: fake ACTIVELY proposes the forbidden inflation in its raw completion`, () => {
      const rawCompletion = buildFixtureJson(c).toLowerCase();
      // At least one forbidden phrase must actually be asserted by the fake — the
      // cheat is a real attempt the filter then has to defeat.
      const proposed = forbidden.filter((f) => rawCompletion.includes(f.toLowerCase()));
      expect(proposed.length, `raw completion must propose ≥1 forbidden phrase for ${c.id}`).toBeGreaterThan(0);
    });

    it(`${c.id}: agent STRIPS every forbidden inflation from its output (filter defeats the cheat)`, async () => {
      const produced = await currentAgent.extract(c.resumeText);
      const haystack = produced
        .map((e) => `${e.kind} ${e.name} ${e.detail ?? ''}`)
        .join('\n')
        .toLowerCase();
      const leaked = forbidden.filter((f) => haystack.includes(f.toLowerCase()));
      expect(leaked, `forbidden inflations leaked for ${c.id}: ${leaked.join(', ')}`).toEqual([]);

      // And the honest entities still survive — the filter didn't nuke real facts.
      const scored = await runExtractionEval(currentAgent, [c]);
      expect(scored.cases[0]?.recall).toBe(1);
    });
  }
});

