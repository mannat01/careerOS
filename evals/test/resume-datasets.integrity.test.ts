/**
 * M03 golden-dataset integrity — runs in `pnpm -w test` (DB-free).
 * Guards the tailoring + scoring datasets themselves: ids unique, every fact
 * ref resolves, adversarial cases are well-formed (gap + honest-closest +
 * forbidden), score bands sane. A dataset that fails these cannot be trusted to
 * gate the Step-2 agents.
 */
import { describe, expect, it } from 'vitest';
import { loadScoringCases, loadTailoringCases } from '../src/datasets.js';

const tailoring = loadTailoringCases();
const scoring = loadScoringCases();

describe('tailoring golden set', () => {
  it('has 12–16 cases with unique ids', () => {
    expect(tailoring.length).toBeGreaterThanOrEqual(12);
    expect(tailoring.length).toBeLessThanOrEqual(16);
    expect(new Set(tailoring.map((c) => c.id)).size).toBe(tailoring.length);
  });

  it('includes 3–4 adversarial "pressure to fabricate" cases', () => {
    const adv = tailoring.filter((c) => c.adversarial);
    expect(adv.length).toBeGreaterThanOrEqual(3);
    expect(adv.length).toBeLessThanOrEqual(4);
  });

  it('every expectedRelevantFactId resolves to a profile fact in the same case', () => {
    for (const c of tailoring) {
      const ids = new Set(c.profile.map((f) => f.id));
      for (const ref of c.expectedRelevantFactIds) {
        expect(ids.has(ref), `${c.id}: dangling relevant ref ${ref}`).toBe(true);
      }
    }
  });

  it('every honestClosestFactId resolves to a profile fact in the same case', () => {
    for (const c of tailoring) {
      const ids = new Set(c.profile.map((f) => f.id));
      for (const ref of c.honestClosestFactIds ?? []) {
        expect(ids.has(ref), `${c.id}: dangling honest-closest ref ${ref}`).toBe(true);
      }
    }
  });

  it('each adversarial case declares a gap, honest-closest evidence, forbidden inflations, and a trap note', () => {
    for (const c of tailoring.filter((x) => x.adversarial)) {
      expect((c.gaps?.length ?? 0), `${c.id} needs a declared gap`).toBeGreaterThan(0);
      expect((c.honestClosestFactIds?.length ?? 0), `${c.id} needs honest-closest evidence`).toBeGreaterThan(0);
      expect((c.forbidden?.length ?? 0), `${c.id} needs forbidden inflation strings`).toBeGreaterThan(0);
      expect(c.trap, `${c.id} needs a trap description`).toBeTruthy();
    }
  });

  it('forbidden inflation strings never appear in the case\'s own real profile facts (the trap must not contradict reality)', () => {
    for (const c of tailoring) {
      const realText = c.profile.map((f) => f.summary.toLowerCase()).join('\n');
      for (const f of c.forbidden ?? []) {
        expect(realText.includes(f.toLowerCase()), `${c.id}: forbidden "${f}" collides with a real fact`).toBe(false);
      }
    }
  });

  it('every case has at least one relevant fact and a non-empty job requirements list', () => {
    for (const c of tailoring) {
      expect(c.expectedRelevantFactIds.length, c.id).toBeGreaterThan(0);
      expect(c.job.requirements.length, c.id).toBeGreaterThan(0);
    }
  });
});

describe('scoring golden set', () => {
  it('has 8–10 cases with unique ids', () => {
    expect(scoring.length).toBeGreaterThanOrEqual(8);
    expect(scoring.length).toBeLessThanOrEqual(10);
    expect(new Set(scoring.map((c) => c.id)).size).toBe(scoring.length);
  });

  it('every score band is sane (0 ≤ min ≤ max ≤ 100)', () => {
    for (const c of scoring) {
      expect(c.expectedBand.min).toBeGreaterThanOrEqual(0);
      expect(c.expectedBand.max).toBeLessThanOrEqual(100);
      expect(c.expectedBand.min).toBeLessThanOrEqual(c.expectedBand.max);
    }
  });

  it('every case requires subscores (a score is never a bare number)', () => {
    for (const c of scoring) {
      expect(c.requiredSubscores.length, c.id).toBeGreaterThan(0);
    }
  });

  it('every explanationMustCite fact id resolves to a profile fact in the same case', () => {
    for (const c of scoring) {
      const ids = new Set(c.profile.map((f) => f.id));
      for (const ref of c.explanationMustCiteFactIds) {
        expect(ids.has(ref), `${c.id}: dangling explanation ref ${ref}`).toBe(true);
      }
    }
  });

  it('covers calibration extremes: at least one high-band (≥80) and one low-band (≤25) case', () => {
    expect(scoring.some((c) => c.expectedBand.min >= 80)).toBe(true);
    expect(scoring.some((c) => c.expectedBand.max <= 25)).toBe(true);
  });

  it('has fabrication guards (forbidden strings) on at least 3 cases', () => {
    expect(scoring.filter((c) => (c.forbidden?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(3);
  });
});
