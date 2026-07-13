/**
 * STATE-MODEL EVAL GATE (M02 acceptance: dimensions grounded in real evidence,
 * confidence within labeled bands, inferred vs demonstrated distinct, zero
 * fabrication).
 *
 * Step 2: the CURRENT agent is now the REAL LlmStateUpdaterAgent
 * (@careeros/cie-state) behind a FakeLlmProvider. The full pipeline (prompt →
 * parse → DETERMINISTIC guardrails) runs for real; only the network LLM call is
 * faked. The fake ACTIVELY proposes the over-reaches the golden set forbids
 * (a demonstrated "distributed systems", an Ohio preference from a license, a
 * value with phantom evidence) — the guardrails must relocate/drop/downgrade
 * every one. All 8 cases (incl. sm-05/06/07/08) must be green.
 * Run: pnpm --filter @careeros/evals eval   (NOT part of `pnpm -w test`)
 */
import { describe, expect, it } from 'vitest';
import { runStateModelEval } from '../src/harness.js';
import { loadStateModelCases } from '../src/datasets.js';
import {
  ACTIVE_OVERREACHES,
  buildStateProposalJson,
  createStateFixtureAgent,
} from '../src/state-fixture-agent.js';

const cases = loadStateModelCases();
const currentAgent = createStateFixtureAgent(cases);

describe('M02 eval gate — career state model', async () => {
  const result = await runStateModelEval(currentAgent, cases);

  it(`zero fabricated dimension values (got ${result.fabricationCount})`, () => {
    expect(result.fabricationCount).toBe(0);
  });

  for (const c of result.cases) {
    it(`case ${c.caseId}: dimensions grounded + confidence in band + evidence linked`, () => {
      expect(c.passed, JSON.stringify(c, null, 2)).toBe(true);
    });
  }
});

/**
 * ACTIVE-OVER-REACH integrity: prove each guardrail is exercised by a REAL
 * assertion, not by the fake simply never proposing it. For every case that
 * carries over-reaches we assert BOTH halves:
 *   (a) the raw model proposal DOES assert the forbidden over-reach, and
 *   (b) the agent's OUTPUT does NOT — the deterministic guardrails defeated it
 *       (relocated to inferred / dropped / kept the no-signal dimension empty),
 *       while the honest values still pass the golden gate.
 * Neuter a guardrail in packages/cie/state io.ts and (b) goes red loudly (the
 * red-test lives beside the agent in the package unit tests).
 */
describe('M02 state-model guardrail — active over-reach probes (sm-02/03/05/06/07/08)', () => {
  const probed = cases.filter((c) => (ACTIVE_OVERREACHES[c.id] ?? []).length > 0);

  it('covers every over-reach case', () => {
    expect(probed.map((c) => c.id).sort()).toEqual([
      'sm-02-new-grad-thin-evidence',
      'sm-03-career-changer-pivot',
      'sm-05-inferred-vs-demonstrated-adjacency',
      'sm-06-claimed-skill-stays-inferred',
      'sm-07-no-ungrounded-dimensions',
      'sm-08-evidence-links-required',
    ]);
  });

  for (const c of probed) {
    const overreaches = ACTIVE_OVERREACHES[c.id] ?? [];

    it(`${c.id}: fake ACTIVELY proposes the forbidden over-reach in its raw completion`, () => {
      const raw = buildStateProposalJson(c).toLowerCase();
      // Every injected over-reach text really appears in the raw proposal.
      for (const o of overreaches) {
        expect(raw.includes(o.text.toLowerCase()), `raw must propose "${o.text}" for ${c.id}`).toBe(true);
      }
    });

    it(`${c.id}: guardrails DEFEAT the over-reach — demonstrated stays clean, no-signal stays empty`, async () => {
      const derived = await currentAgent.derive(c.profile);
      const dim = (key: string): { values: string[]; evidenceRefs: string[] } =>
        derived.find((d) => d.dimension === key) ?? { values: [], evidenceRefs: [] };
      const has = (key: string, text: string): boolean =>
        dim(key).values.some((v) => v.toLowerCase() === text.toLowerCase());

      for (const o of overreaches) {
        if (o.dimension === 'demonstrated_skills') {
          // A demonstrated over-reach must NOT survive as demonstrated…
          expect(has('demonstrated_skills', o.text), `${o.text} leaked into demonstrated for ${c.id}`).toBe(false);
          // …and on a rich profile it is relocated to inferred (sm-05/06); on a
          // thin profile (sm-02) it is dropped entirely — never demonstrated either way.
        }
        if (o.dimension === 'geographic_preferences') {
          expect(has('geographic_preferences', o.text), `no-signal geo leaked for ${c.id}`).toBe(false);
        }
        if (o.dimension === 'compensation_goals') {
          expect(dim('compensation_goals').values.length, `no-signal comp leaked for ${c.id}`).toBe(0);
        }
        if (o.dimension === 'leadership_readiness') {
          expect(has('leadership_readiness', o.text), `ungrounded readiness leaked for ${c.id}`).toBe(false);
        }
      }

      // Phantom-evidence value (cites f99) must never appear anywhere.
      const phantom = overreaches.find((o) => o.evidenceRefs.includes('f99'));
      if (phantom) {
        const anywhere = derived.some((d) => d.values.some((v) => v.toLowerCase() === phantom.text.toLowerCase()));
        expect(anywhere, `phantom-evidence value survived for ${c.id}`).toBe(false);
      }

      // sm-05/06 specifically: the adjacency/claim is downgraded, not deleted.
      if (c.id === 'sm-05-inferred-vs-demonstrated-adjacency') {
        expect(has('inferred_skills', 'distributed systems')).toBe(true);
      }
      if (c.id === 'sm-06-claimed-skill-stays-inferred') {
        expect(has('inferred_skills', 'Tableau')).toBe(true);
      }
    });
  }
});
