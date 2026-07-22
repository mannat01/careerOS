/**
 * M09 golden-dataset integrity — runs in `pnpm -w test` (DB-free).
 *
 * Guards the interview-prep golden set itself:
 *   - ids unique; size inside the workorder band (8–12 total, 3–4 adversarial);
 *   - every case internally consistent (allowedFactRefs is a proper universe
 *     for the profile + graph, mustCoverRequirements is a subset of the
 *     opportunity requirements, answerGroundingFactIds cites only allowed
 *     factRefs, gapCompetencies is a subset of the opportunity requirements
 *     that the profile does NOT cover with grounding evidence);
 *   - every adversarial case carries a trap note + forbidden strings and the
 *     four bait patterns (missing experience, fabricated metric, inflated
 *     seniority, invented technology) are ALL represented exactly once.
 *
 * A dataset that fails these checks cannot be trusted to gate the Step-2
 * interviewer agent.
 */
import { describe, expect, it } from 'vitest';
import { loadInterviewPrepCases } from '../src/datasets.js';
import type { InterviewPrepCase } from '../src/types.js';

const cases: InterviewPrepCase[] = loadInterviewPrepCases();

describe('M09 interview-prep golden set — dataset integrity', () => {
  it('has 8–12 total cases including 3–4 adversarial (workorder band)', () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
    expect(cases.length).toBeLessThanOrEqual(12);
    const adv = cases.filter((c) => c.adversarial);
    expect(adv.length).toBeGreaterThanOrEqual(3);
    expect(adv.length).toBeLessThanOrEqual(4);
  });

  it('has unique case ids', () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it('every case has at least one mustCoverRequirement + at least one question kind', () => {
    for (const c of cases) {
      expect(
        c.expected.mustCoverRequirements.length,
        `${c.id}: needs at least one mustCoverRequirement`,
      ).toBeGreaterThan(0);
      expect(
        c.expected.mustGenerateQuestionKinds.length,
        `${c.id}: needs at least one required question kind`,
      ).toBeGreaterThan(0);
    }
  });

  it('every mustCoverRequirement is a real JD requirement on the opportunity', () => {
    for (const c of cases) {
      const real = new Set(c.input.opportunity.requirements);
      for (const r of c.expected.mustCoverRequirements) {
        expect(
          real.has(r),
          `${c.id}: mustCoverRequirement "${r}" is not on opportunity.requirements`,
        ).toBe(true);
      }
    }
  });

  it('every gapCompetency is a real JD requirement on the opportunity', () => {
    for (const c of cases) {
      const real = new Set(c.input.opportunity.requirements);
      for (const g of c.expected.gapCompetencies) {
        expect(
          real.has(g),
          `${c.id}: gapCompetency "${g}" is not on opportunity.requirements`,
        ).toBe(true);
      }
    }
  });

  it('allowedFactRefs covers every profile-fact id and every graph-node id in the case', () => {
    for (const c of cases) {
      const allowed = new Set(c.input.allowedFactRefs);
      for (const p of c.input.profile) {
        expect(
          allowed.has(p.id),
          `${c.id}: profile fact ${p.id} missing from allowedFactRefs`,
        ).toBe(true);
      }
      for (const n of c.input.graph) {
        expect(
          allowed.has(n.id),
          `${c.id}: graph node ${n.id} missing from allowedFactRefs`,
        ).toBe(true);
      }
    }
  });

  it('every state-model evidenceRef resolves to allowedFactRefs (case is self-consistent)', () => {
    for (const c of cases) {
      const allowed = new Set(c.input.allowedFactRefs);
      for (const dim of c.input.stateModel) {
        for (const ref of dim.evidenceRefs) {
          expect(
            allowed.has(ref),
            `${c.id}: state dim ${dim.dimension} cites ${ref} but it's not on allowedFactRefs`,
          ).toBe(true);
        }
      }
    }
  });

  it('every answerGroundingFactIds entry maps a mustCoverRequirement to real factRefs', () => {
    for (const c of cases) {
      const mustCover = new Set(c.expected.mustCoverRequirements);
      const allowed = new Set(c.input.allowedFactRefs);
      for (const [requirement, factIds] of Object.entries(
        c.expected.answerGroundingFactIds,
      )) {
        expect(
          mustCover.has(requirement),
          `${c.id}: answerGroundingFactIds key "${requirement}" is not on mustCoverRequirements`,
        ).toBe(true);
        expect(factIds.length, `${c.id}: "${requirement}" has zero grounding facts`).toBeGreaterThan(0);
        for (const factId of factIds) {
          expect(
            allowed.has(factId),
            `${c.id}: "${requirement}" cites ${factId} but it's not on allowedFactRefs`,
          ).toBe(true);
        }
      }
    }
  });

  it('gapCompetencies and answerGroundingFactIds are disjoint (a gap has no real grounding facts)', () => {
    for (const c of cases) {
      const gapSet = new Set(c.expected.gapCompetencies);
      for (const requirement of Object.keys(c.expected.answerGroundingFactIds)) {
        expect(
          gapSet.has(requirement),
          `${c.id}: "${requirement}" appears in BOTH answerGroundingFactIds AND gapCompetencies (contradiction)`,
        ).toBe(false);
      }
    }
  });

  it('allowedGapStrategies is a non-empty subset of {honest_bridge, address_gap}', () => {
    const valid = new Set(['honest_bridge', 'address_gap']);
    for (const c of cases) {
      expect(c.expected.allowedGapStrategies.length).toBeGreaterThan(0);
      for (const s of c.expected.allowedGapStrategies) {
        expect(valid.has(s), `${c.id}: invalid gap strategy ${s}`).toBe(true);
      }
    }
  });

  it('every adversarial case declares a trap note + forbidden strings', () => {
    const adv = cases.filter((c) => c.adversarial);
    for (const c of adv) {
      expect(c.trap, `${c.id} needs a trap description`).toBeTruthy();
      expect(
        (c.forbidden ?? []).length,
        `${c.id} needs forbidden strings`,
      ).toBeGreaterThan(0);
    }
  });

  it('adversarial coverage — the four bait patterns are represented', () => {
    const advIds = cases.filter((c) => c.adversarial).map((c) => c.id);
    for (const required of [
      'ip-09-adv-role-demands-missing-experience',
      'ip-10-adv-fabricated-metric',
      'ip-11-adv-inflated-seniority',
      'ip-12-adv-invented-technology',
    ]) {
      expect(advIds, `missing adversarial ${required}`).toContain(required);
    }
  });
});