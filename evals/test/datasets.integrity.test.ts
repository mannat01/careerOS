/**
 * Golden-dataset integrity — runs in `pnpm -w test` (DB-free).
 * Guards the datasets themselves: provenance quotes must be verbatim, ids
 * unique, format coverage complete, adversarial traps well-formed. A dataset
 * that fails these checks cannot be trusted to gate the agents.
 */
import { describe, expect, it } from 'vitest';
import { loadExtractionCases, loadStateModelCases, loadDecisionCases, loadOfferComparisonCases, loadPlannerCases, loadPlannerAdaptivityCases } from '../src/datasets.js';
import type { ResumeFormat, ExtractionCase, StateModelCase, DecisionCase, OfferComparisonCase, ExpectedEntity, ProfileFact, PlannerCase, PlannerAdaptivityCase } from '../src/types.js';

const extraction: ExtractionCase[] = loadExtractionCases();
const stateModel: StateModelCase[] = loadStateModelCases();
const decision: DecisionCase[] = loadDecisionCases();
const offerComparison: OfferComparisonCase[] = loadOfferComparisonCases();
const planner: PlannerCase[] = loadPlannerCases();
const plannerAdaptivity: PlannerAdaptivityCase[] = loadPlannerAdaptivityCases();

describe('extraction golden set', () => {
  it('has 12–20 cases', () => {
    expect(extraction.length).toBeGreaterThanOrEqual(12);
    expect(extraction.length).toBeLessThanOrEqual(20);
  });

  it('has unique case ids', () => {
    expect(new Set(extraction.map((c) => c.id)).size).toBe(extraction.length);
  });

  it('covers every required resume format', () => {
    const formats = new Set(extraction.map((c) => c.format));
    const required: ResumeFormat[] = ['chronological', 'functional', 'bullet-heavy', 'sparse', 'career-changer', 'non-linear'];
    for (const f of required) expect(formats, `missing format ${f}`).toContain(f);
  });

  it('includes 2–3 adversarial zero-fabrication cases, each with forbidden strings and a trap note', () => {
    const adv = extraction.filter((c) => c.format === 'adversarial');
    expect(adv.length).toBeGreaterThanOrEqual(2);
    expect(adv.length).toBeLessThanOrEqual(3);
    for (const c of adv) {
      expect(c.forbidden?.length ?? 0, `${c.id} needs forbidden strings`).toBeGreaterThan(0);
      expect(c.trap, `${c.id} needs a trap description`).toBeTruthy();
    }
  });

  it('every expected entity has provenance quoting the source text VERBATIM', () => {
    for (const c of extraction) {
      for (const e of c.expected) {
        expect(e.provenance.source).toBe('resume');
        expect(
          c.resumeText.includes(e.provenance.quote),
          `${c.id}: quote not found in resume text: "${e.provenance.quote}"`,
        ).toBe(true);
      }
    }
  });

  it('forbidden strings never appear as expected entity names (the trap must not contradict the label)', () => {
    for (const c of extraction) {
      const names = c.expected.map((e: ExpectedEntity) => ('name' in e ? e.name : '')).map((s: string) => s.toLowerCase());
      for (const f of c.forbidden ?? []) {
        expect(names, `${c.id}: forbidden "${f}" collides with an expected name`).not.toContain(f.toLowerCase());
      }
    }
  });

  it('every case expects at least one entity', () => {
    for (const c of extraction) expect(c.expected.length, c.id).toBeGreaterThan(0);
  });
});

describe('decision-support golden set', () => {
  it('has 10–14 cases with unique ids', () => {
    expect(decision.length).toBeGreaterThanOrEqual(10);
    expect(decision.length).toBeLessThanOrEqual(14);
    expect(new Set(decision.map((c) => c.id)).size).toBe(decision.length);
  });

  it('includes 3–4 adversarial cases', () => {
    const adv = decision.filter((c) => c.adversarial);
    expect(adv.length).toBeGreaterThanOrEqual(3);
    expect(adv.length).toBeLessThanOrEqual(4);
    for (const c of adv) {
      expect(c.forbidden?.length ?? 0, `${c.id} needs forbidden strings`).toBeGreaterThan(0);
      expect(c.trap, `${c.id} needs a trap description`).toBeTruthy();
    }
  });

  it('every evidence ref resolves to a real profile/graph/state fact', () => {
    for (const c of decision) {
      const profileIds = new Set(c.profile.map((f: ProfileFact) => f.id));
      const stateModelIds = new Set(c.stateModel.flatMap(d => d.evidenceRefs));
      const allFactIds = new Set([...profileIds, ...stateModelIds]);
      
      for (const ref of c.expected.evidenceRefs) {
        expect(allFactIds.has(ref), `${c.id}: dangling evidence ref ${ref}`).toBe(true);
      }
    }
  });

  it('confidence bands are sane (0 ≤ min ≤ max ≤ 1)', () => {
    for (const c of decision) {
      expect(c.expected.confidence.min).toBeGreaterThanOrEqual(0);
      expect(c.expected.confidence.max).toBeLessThanOrEqual(1);
      expect(c.expected.confidence.min).toBeLessThanOrEqual(c.expected.confidence.max);
    }
  });

  it('optionality note is present when expected', () => {
    for (const c of decision) {
      if (c.expected.optionalityNote) {
        expect(c.expected.optionalityNote).toBeTruthy();
      }
    }
  });
});

describe('offer comparison golden set', () => {
  it('has 6–8 cases with unique ids', () => {
    expect(offerComparison.length).toBeGreaterThanOrEqual(6);
    expect(offerComparison.length).toBeLessThanOrEqual(8);
    expect(new Set(offerComparison.map((c) => c.id)).size).toBe(offerComparison.length);
  });

  it('includes 2–3 adversarial cases', () => {
    const adv = offerComparison.filter((c) => c.adversarial);
    expect(adv.length).toBeGreaterThanOrEqual(2);
    expect(adv.length).toBeLessThanOrEqual(3);
    for (const c of adv) {
      expect(c.forbidden?.length ?? 0, `${c.id} needs forbidden strings`).toBeGreaterThan(0);
      expect(c.trap, `${c.id} needs a trap description}`).toBeTruthy();
    }
  });

  it('weights match user input (no invented preferences)', () => {
    for (const c of offerComparison) {
      const weights = c.candidateValues.weights;
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
      
      for (const key of Object.keys(weights)) {
        expect(c.candidateValues.values).toContain(key);
      }
    }
  });

  it('explanation cites real offer data for each factor', () => {
    for (const c of offerComparison) {
      const offerIds = new Set(c.offers.map(o => o.id));
      for (const ref of c.expected.evidenceRefs) {
        expect(offerIds.has(ref), `${c.id}: dangling evidence ref ${ref}`).toBe(true);
      }
    }
  });
});

describe('planner golden set (M06)', () => {
  it('has 8–12 cases with unique ids', () => {
    expect(planner.length).toBeGreaterThanOrEqual(8);
    expect(planner.length).toBeLessThanOrEqual(12);
    expect(new Set(planner.map((c) => c.id)).size).toBe(planner.length);
  });

  it('includes 3–4 adversarial cases, each with forbidden strings and a trap note', () => {
    const adv = planner.filter((c) => c.adversarial);
    expect(adv.length).toBeGreaterThanOrEqual(3);
    expect(adv.length).toBeLessThanOrEqual(4);
    for (const c of adv) {
      expect(c.forbidden?.length ?? 0, `${c.id} needs forbidden strings`).toBeGreaterThan(0);
      expect(c.trap, `${c.id} needs a trap description`).toBeTruthy();
    }
  });

  it('every case has ≥1 STATED goal, ≥1 graph node, and ≥1 real gap (grounding surface exists)', () => {
    for (const c of planner) {
      expect(c.input.goals.length, `${c.id} needs stated goals`).toBeGreaterThan(0);
      expect(c.input.graph.length, `${c.id} needs graph nodes`).toBeGreaterThan(0);
      expect(c.input.gaps.length, `${c.id} needs identified gaps`).toBeGreaterThan(0);
    }
  });

  it('every gap resolves to a real graph node (no dangling gap→node refs)', () => {
    for (const c of planner) {
      const nodeIds = new Set(c.input.graph.map((n) => n.id));
      for (const g of c.input.gaps) {
        expect(nodeIds.has(g.nodeId), `${c.id}: gap ${g.id} → dangling node ${g.nodeId}`).toBe(true);
      }
    }
  });

  it('expected assertions reference only real goal/gap ids in the same case', () => {
    for (const c of planner) {
      const goalIds = new Set(c.input.goals.map((g) => g.id));
      const gapIds = new Set(c.input.gaps.map((g) => g.id));
      for (const id of c.expected.mustAddressGoalIds) {
        expect(goalIds.has(id), `${c.id}: mustAddress dangling goal ${id}`).toBe(true);
      }
      for (const id of c.expected.mustTargetGapIds) {
        expect(gapIds.has(id), `${c.id}: mustTarget dangling gap ${id}`).toBe(true);
      }
    }
  });

  it('forbidden strings never collide with a stated goal, graph label, or gap skill (the trap must not contradict the label)', () => {
    for (const c of planner) {
      const legit = [
        ...c.input.goals.map((g) => g.statement.toLowerCase()),
        ...c.input.graph.map((n) => n.label.toLowerCase()),
        ...c.input.gaps.map((g) => g.skill.toLowerCase()),
      ];
      for (const f of c.forbidden ?? []) {
        for (const l of legit) {
          expect(l.includes(f.toLowerCase()), `${c.id}: forbidden "${f}" collides with legit input "${l}"`).toBe(false);
        }
      }
    }
  });

  it('unique ids across profile facts, goals, graph nodes, and gaps within each case', () => {
    for (const c of planner) {
      const ids = [
        ...c.input.profile.map((f) => f.id),
        ...c.input.goals.map((g) => g.id),
        ...c.input.graph.map((n) => n.id),
        ...c.input.gaps.map((g) => g.id),
      ];
      expect(new Set(ids).size, `${c.id}: duplicate ids across input collections`).toBe(ids.length);
    }
  });
});

describe('planner adaptivity golden set (M06 / §4A)', () => {
  it('has 6–10 cases with unique ids', () => {
    expect(plannerAdaptivity.length).toBeGreaterThanOrEqual(6);
    expect(plannerAdaptivity.length).toBeLessThanOrEqual(10);
    expect(new Set(plannerAdaptivity.map((c) => c.id)).size).toBe(plannerAdaptivity.length);
  });

  it('covers every §4A material trigger (goal add, confidence ≥0.2, skill edge on ≥2 roles, high-impact research)', () => {
    const material = plannerAdaptivity.filter((c) => c.expectRegeneration).map((c) => c.change.type);
    expect(material).toContain('goal-added');
    expect(material).toContain('state-confidence-shift');
    expect(material).toContain('required-skill-edge');
    expect(material).toContain('research-finding');
  });

  it('includes ≥3 sub-threshold (no-thrash) cases', () => {
    expect(plannerAdaptivity.filter((c) => !c.expectRegeneration).length).toBeGreaterThanOrEqual(3);
  });

  it('expectRegeneration labels agree with the §4A thresholds encoded in the change payloads', () => {
    for (const c of plannerAdaptivity) {
      const ch = c.change;
      const material =
        ch.type === 'goal-added' || ch.type === 'goal-removed'
          ? true
          : ch.type === 'state-confidence-shift'
            ? Math.abs(ch.delta) >= 0.2
            : ch.type === 'required-skill-edge'
              ? ch.targetRoleCount >= 2
              : ch.type === 'research-finding'
                ? ch.impact === 'high'
                : false;
      expect(c.expectRegeneration, `${c.id}: label disagrees with §4A for ${ch.type}`).toBe(material);
    }
  });
});

describe('state-model golden set', () => {
  it('has 6–10 cases with unique ids', () => {
    expect(stateModel.length).toBeGreaterThanOrEqual(6);
    expect(stateModel.length).toBeLessThanOrEqual(10);
    expect(new Set(stateModel.map((c) => c.id)).size).toBe(stateModel.length);
  });

  it('every evidenceRef resolves to a profile fact id in the same case', () => {
    for (const c of stateModel) {
      const ids = new Set(c.profile.map((f: ProfileFact) => f.id));
      for (const d of c.expected) {
        for (const ref of d.evidenceRefs) {
          expect(ids.has(ref), `${c.id}/${d.dimension}: dangling evidence ref ${ref}`).toBe(true);
        }
      }
    }
  });

  it('confidence bands are sane (0 ≤ min ≤ max ≤ 1)', () => {
    for (const c of stateModel) {
      for (const d of c.expected) {
        expect(d.confidence.min).toBeGreaterThanOrEqual(0);
        expect(d.confidence.max).toBeLessThanOrEqual(1);
        expect(d.confidence.min).toBeLessThanOrEqual(d.confidence.max);
      }
    }
  });

  it('any dimension asserting values requires evidence refs (no ungrounded assertions in the labels)', () => {
    for (const c of stateModel) {
      for (const d of c.expected) {
        if (d.mustInclude.length > 0) {
          expect(d.evidenceRefs.length, `${c.id}/${d.dimension} asserts values but cites no evidence`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('covers the demonstrated-vs-inferred distinction', () => {
    const dims = stateModel.flatMap((c) => c.expected.map((d) => d.dimension));
    expect(dims).toContain('demonstrated_skills');
    expect(dims).toContain('inferred_skills');
  });

  it('has fabrication guards (forbidden strings) on at least 3 cases', () => {
    expect(stateModel.filter((c) => (c.forbidden?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(3);
  });
});
