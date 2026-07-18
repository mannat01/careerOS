/**
 * M07 research-synthesis harness self-tests — prove the scorer discriminates
 * good from bad BEFORE the real synthesizer exists.
 *
 *   - oracle → passes every case (grounded/personalized/actionable/calibrated);
 *   - fabricator/generic → CAUGHT on every case:
 *       * fabricated market trend (no supporting finding),
 *       * nonexistent (non-allow-listed) source citation,
 *       * generic advice not tied to user's state/plan,
 *       * over-claim certainty from a single weak finding;
 *   - stub → RED across the board (pre-Step-2).
 */
import { describe, expect, it } from 'vitest';
import { runResearchSynthesisEval, scoreResearchSynthesisCase } from '../src/harness.js';
import { loadResearchSynthesisCases } from '../src/datasets.js';
import {
  createOracleResearchSynthesisAgent,
  fabricatorResearchSynthesisAgent,
  StubResearchSynthesisAgent,
} from '../src/research-agents.js';

const cases = loadResearchSynthesisCases();

describe('M07 research-synthesis harness — golden set shape', () => {
  it('carries 8–12 cases with 3–4 adversarial (per M07 workorder)', () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
    expect(cases.length).toBeLessThanOrEqual(12);
    const adv = cases.filter((c) => c.adversarial);
    expect(adv.length).toBeGreaterThanOrEqual(3);
    expect(adv.length).toBeLessThanOrEqual(4);
  });

  it('covers each named adversarial trap (fabricated trend, nonexistent source, generic advice, over-claim)', () => {
    const ids = cases.filter((c) => c.adversarial).map((c) => c.id);
    expect(ids).toContain('rs-09-adv-fabricated-trend');
    expect(ids).toContain('rs-10-adv-nonexistent-source');
    expect(ids).toContain('rs-11-adv-generic-advice');
    expect(ids).toContain('rs-12-adv-overclaim-certainty');
  });
});

describe('M07 research-synthesis harness — oracle passes every case', () => {
  it('oracle synthesizer passes the full suite', async () => {
    const oracle = createOracleResearchSynthesisAgent(cases);
    const result = await runResearchSynthesisEval(oracle, cases);
    expect(result.fabricationCount).toBe(0);
    expect(result.adversarialFabrications).toBe(0);
    expect(result.genericInsightCount).toBe(0);
    expect(result.overclaimCount).toBe(0);
    for (const c of result.cases) {
      expect(c.passed, `${c.caseId} should pass with oracle: ${JSON.stringify(c)}`).toBe(true);
    }
    expect(result.passed).toBe(true);
  });
});

describe('M07 research-synthesis harness — fabricator/generic is CAUGHT on every case', () => {
  it('fabricator fails every case with named grounding/personalization/actionability/calibration leaks', async () => {
    const result = await runResearchSynthesisEval(fabricatorResearchSynthesisAgent, cases);
    expect(result.passed).toBe(false);
    for (const c of result.cases) {
      expect(c.passed, `${c.caseId} must be CAUGHT: ${JSON.stringify(c)}`).toBe(false);
    }
    // The specific sins the fabricator commits show up in the suite totals.
    expect(result.fabricationCount).toBeGreaterThan(0);
    expect(result.adversarialFabrications).toBeGreaterThan(0);
    expect(result.genericInsightCount).toBeGreaterThan(0);
    expect(result.overclaimCount).toBeGreaterThan(0);
  });

  it('fabricated market trend is dropped (rs-09): ungrounded insight caught', async () => {
    const c = cases.find((x) => x.id === 'rs-09-adv-fabricated-trend')!;
    const s = await fabricatorResearchSynthesisAgent.synthesize(c.input);
    const r = scoreResearchSynthesisCase(c, s);
    expect(r.passed).toBe(false);
    expect(r.ungroundedInsights.length).toBeGreaterThan(0);
    expect(r.fabrications.length).toBeGreaterThan(0);
  });

  it('nonexistent source is rejected (rs-10): unsanctioned citation caught', async () => {
    const c = cases.find((x) => x.id === 'rs-10-adv-nonexistent-source')!;
    const s = await fabricatorResearchSynthesisAgent.synthesize(c.input);
    const r = scoreResearchSynthesisCase(c, s);
    expect(r.passed).toBe(false);
    expect(r.unsanctionedCitations.length).toBeGreaterThan(0);
    expect(r.fabrications.length).toBeGreaterThan(0);
  });

  it('generic advice is rejected (rs-11): recommendation without gap/goal/plan-action link caught', async () => {
    const c = cases.find((x) => x.id === 'rs-11-adv-generic-advice')!;
    const s = await fabricatorResearchSynthesisAgent.synthesize(c.input);
    const r = scoreResearchSynthesisCase(c, s);
    expect(r.passed).toBe(false);
    expect(r.ungroundedRecommendations.length).toBeGreaterThan(0);
    expect(r.genericInsights.length).toBeGreaterThan(0);
    expect(r.fabrications.length).toBeGreaterThan(0);
  });

  it('over-claim certainty is rejected (rs-12): weak-supported insight above cap caught', async () => {
    const c = cases.find((x) => x.id === 'rs-12-adv-overclaim-certainty')!;
    const s = await fabricatorResearchSynthesisAgent.synthesize(c.input);
    const r = scoreResearchSynthesisCase(c, s);
    expect(r.passed).toBe(false);
    expect(r.overclaimedInsights.length).toBeGreaterThan(0);
    expect(r.fabrications.length).toBeGreaterThan(0);
  });
});

describe('M07 research-synthesis harness — stub is RED (pre-Step-2)', () => {
  it('stub synthesizer fails every case (empty output ⇒ must-surface findings dropped, mustLink unmet)', async () => {
    const result = await runResearchSynthesisEval(new StubResearchSynthesisAgent(), cases);
    expect(result.passed).toBe(false);
    expect(result.cases.every((c) => !c.passed)).toBe(true);
    // Every case has at least one must-surface finding OR at least one mustLink id.
    for (const c of result.cases) {
      const unmet =
        c.droppedRequiredFindings.length + c.unlinkedRequirements.length;
      expect(unmet, `${c.caseId} must have unmet requirements with stub`).toBeGreaterThan(0);
    }
  });
});