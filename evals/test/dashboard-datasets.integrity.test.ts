/**
 * M08 golden-dataset integrity — runs in `pnpm -w test` (DB-free).
 * Guards the intelligence-dashboard golden set itself: ids unique, size
 * inside the workorder band (8–12 standard + 4 adversarial), every input
 * ref internally consistent (allowedEvidenceRefs is a proper universe),
 * every ExpectedDashboardMetric well-formed (bands ordered, cheerleading
 * gate correctly wired on flat/declining trends, adversarial cases carry a
 * trap note + forbidden strings). A dataset that fails these checks cannot
 * be trusted to gate the composer in Step 2.
 */
import { describe, expect, it } from 'vitest';
import { loadDashboardMetricCases } from '../src/datasets.js';
import type { DashboardMetricCase, DashboardMetricKey } from '../src/types.js';

const cases: DashboardMetricCase[] = loadDashboardMetricCases();

const ALL_METRIC_KEYS: DashboardMetricKey[] = [
  'career_momentum',
  'interview_readiness',
  'skill_momentum',
  'market_positioning',
  'salary_trajectory',
  'opportunity_quality',
  'networking_strength',
  'recruiter_engagement',
  'portfolio_completeness',
  'strategic_recommendations',
];

describe('M08 dashboard-metric golden set — dataset integrity', () => {
  it('has 8–12 total cases including 3–4 adversarial (workorder band)', () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
    expect(cases.length).toBeLessThanOrEqual(16);
    const adv = cases.filter((c) => c.adversarial);
    expect(adv.length).toBeGreaterThanOrEqual(3);
    expect(adv.length).toBeLessThanOrEqual(4);
  });

  it('has unique case ids', () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it('every case has at least one ExpectedDashboardMetric', () => {
    for (const c of cases) {
      expect(c.expected.metrics.length, `${c.id} has no expected metrics`).toBeGreaterThan(0);
    }
  });

  it('every expected metric key is on the frozen A1.6 list', () => {
    const allowed = new Set(ALL_METRIC_KEYS);
    for (const c of cases) {
      for (const e of c.expected.metrics) {
        expect(allowed.has(e.key), `${c.id}: unknown metric key ${e.key}`).toBe(true);
      }
    }
  });

  it('every allowed evidence ref is unique per case (no duplicate ids)', () => {
    for (const c of cases) {
      const refs = c.input.allowedEvidenceRefs;
      expect(new Set(refs).size, `${c.id}: duplicate allowedEvidenceRefs`).toBe(refs.length);
    }
  });

  it('every mustCiteEvidenceRefs is a subset of allowedEvidenceRefs (internal grounding)', () => {
    for (const c of cases) {
      const allowed = new Set(c.input.allowedEvidenceRefs);
      for (const e of c.expected.metrics) {
        for (const ref of e.mustCiteEvidenceRefs ?? []) {
          expect(
            allowed.has(ref),
            `${c.id}: expected metric ${e.key} requires ${ref} but it's not on allowedEvidenceRefs`,
          ).toBe(true);
        }
      }
    }
  });

  it('every mustLinkPlanActionId resolves to a real activePlanAction (internal linkage)', () => {
    for (const c of cases) {
      const actions = new Set(c.input.activePlanActions.map((a) => a.id));
      for (const e of c.expected.metrics) {
        if (e.mustLinkPlanActionId) {
          expect(
            actions.has(e.mustLinkPlanActionId),
            `${c.id}: expected metric ${e.key} requires action ${e.mustLinkPlanActionId} but it's not on activePlanActions`,
          ).toBe(true);
        }
      }
    }
  });

  it('every state-model evidenceRef resolves to allowedEvidenceRefs (case is self-consistent)', () => {
    for (const c of cases) {
      const allowed = new Set(c.input.allowedEvidenceRefs);
      for (const dim of c.input.stateModel) {
        for (const ref of dim.evidenceRefs) {
          expect(
            allowed.has(ref),
            `${c.id}: state dim ${dim.dimension} cites ${ref} but it's not on allowedEvidenceRefs`,
          ).toBe(true);
        }
      }
    }
  });

  it('every graph node id + finding id + plan-action id is on allowedEvidenceRefs', () => {
    for (const c of cases) {
      const allowed = new Set(c.input.allowedEvidenceRefs);
      for (const n of c.input.graph) {
        expect(allowed.has(n.id), `${c.id}: graph node ${n.id} missing from allowedEvidenceRefs`).toBe(
          true,
        );
      }
      for (const f of c.input.findings) {
        expect(allowed.has(f.id), `${c.id}: finding ${f.id} missing from allowedEvidenceRefs`).toBe(
          true,
        );
      }
      for (const a of c.input.activePlanActions) {
        expect(allowed.has(a.id), `${c.id}: plan action ${a.id} missing from allowedEvidenceRefs`).toBe(
          true,
        );
      }
    }
  });

  it('every value band is ordered (min <= max) and inside 0–100', () => {
    for (const c of cases) {
      for (const e of c.expected.metrics) {
        if (e.valueBand) {
          expect(e.valueBand.min).toBeLessThanOrEqual(e.valueBand.max);
          expect(e.valueBand.min).toBeGreaterThanOrEqual(0);
          expect(e.valueBand.max).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('every confidence band is ordered (min <= max) and inside 0–1', () => {
    for (const c of cases) {
      for (const e of c.expected.metrics) {
        expect(e.confidenceBand.min).toBeLessThanOrEqual(e.confidenceBand.max);
        expect(e.confidenceBand.min).toBeGreaterThanOrEqual(0);
        expect(e.confidenceBand.max).toBeLessThanOrEqual(1);
      }
    }
  });

  it('insufficient_data metrics use a LOW confidence band (max <= 0.5)', () => {
    for (const c of cases) {
      for (const e of c.expected.metrics) {
        if (e.status === 'insufficient_data') {
          expect(
            e.confidenceBand.max,
            `${c.id}: insufficient_data on ${e.key} must cap confidence (max <= 0.5)`,
          ).toBeLessThanOrEqual(0.5);
        }
      }
    }
  });

  it('insufficient_data metrics must NOT declare a valueBand or a mustLinkPlanActionId', () => {
    for (const c of cases) {
      for (const e of c.expected.metrics) {
        if (e.status === 'insufficient_data') {
          expect(e.valueBand, `${c.id}: insufficient_data ${e.key} should not declare a valueBand`).toBeUndefined();
          expect(
            e.mustLinkPlanActionId,
            `${c.id}: insufficient_data ${e.key} should not declare mustLinkPlanActionId`,
          ).toBeUndefined();
        }
      }
    }
  });

  it('every adversarial case declares a trap note + forbidden strings', () => {
    const adv = cases.filter((c) => c.adversarial);
    for (const c of adv) {
      expect(c.trap, `${c.id} needs a trap description`).toBeTruthy();
      expect((c.forbidden ?? []).length, `${c.id} needs forbidden strings`).toBeGreaterThan(0);
    }
  });

  it('adversarial coverage — exactly the four bait patterns are represented', () => {
    const advIds = cases.filter((c) => c.adversarial).map((c) => c.id);
    for (const required of [
      'dm-09-adv-cheerleader-flat-trend',
      'dm-10-adv-fabricated-no-evidence',
      'dm-11-adv-nonexistent-evidence-ref',
      'dm-12-adv-nonexistent-plan-action',
    ]) {
      expect(advIds, `missing adversarial ${required}`).toContain(required);
    }
  });
});