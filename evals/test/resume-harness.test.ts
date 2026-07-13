/**
 * M03 harness self-tests — prove the tailoring + scoring scorers discriminate
 * good from bad BEFORE any real agent exists. If these can't catch a fabricator
 * or reward an oracle, the eval gate is decorative.
 *
 *   - oracle tailor/scorer → passes every case;
 *   - stub → fails (gate is red pre-Step-2);
 *   - fabricator → CAUGHT by the zero-fabrication gate on every adversarial
 *     case (structural ungrounded factId + lexical forbidden inflation);
 *   - atsCheck → flags real ATS hazards;
 *   - scoring → catches band, missing-subscore, ungrounded-explanation,
 *     forbidden-fabrication, and non-reproducibility failures.
 */
import { describe, expect, it } from 'vitest';
import {
  atsCheck,
  runScoringEval,
  runTailoringEval,
  scoreScoringCase,
  scoreTailoringCase,
} from '../src/harness.js';
import { loadScoringCases, loadTailoringCases } from '../src/datasets.js';
import {
  StubScoringAgent,
  StubTailoringAgent,
  fabricatorTailoringAgent,
  oracleScoringAgent,
  oracleTailoringAgent,
} from '../src/resume-agents.js';
import type { MatchScore } from '../src/types.js';

const tailoring = loadTailoringCases();
const scoring = loadScoringCases();

/** Summary text of a fact by id (avoids unchecked array indexing). */
function summaryOf(caseId: string, factId: string): string {
  const c = tailoring.find((x) => x.id === caseId)!;
  return c.profile.find((f) => f.id === factId)!.summary;
}


describe('tailoring scorer — self-validation', () => {
  it('the oracle tailor passes every case (grounded + relevant + ATS-safe + honest-closest)', async () => {
    const r = await runTailoringEval(oracleTailoringAgent, tailoring);
    expect(r.fabricationCount).toBe(0);
    expect(r.adversarialFabrications).toBe(0);
    expect(r.passed).toBe(true);
  });

  it('the stub tailor fails (the eval gate is red pre-Step-2)', async () => {
    const r = await runTailoringEval(new StubTailoringAgent(), tailoring);
    expect(r.passed).toBe(false);
  });

  it('the FABRICATOR is caught by the zero-fabrication gate on every adversarial case', async () => {
    for (const c of tailoring.filter((x) => x.adversarial)) {
      const produced = await fabricatorTailoringAgent.tailor(c.profile, c.job);
      const scored = scoreTailoringCase(c, produced);
      expect(scored.passed, `${c.id}: fabricator must be rejected`).toBe(false);
      // Its structural fabrication (ungrounded bullet) is always caught…
      expect(scored.ungroundedFactIds).toContain('FABRICATED');
      // …and its lexical fabrication renders the forbidden gap inflation.
      expect(scored.fabrications.length, `${c.id}: forbidden inflation must be detected`).toBeGreaterThan(0);
    }
  });

  it('catches lexical fabrication directly: rendering a forbidden gap string fails tl-11', () => {
    const c = tailoring.find((x) => x.id === 'tl-11-adv-demands-kubernetes')!;
    const scored = scoreTailoringCase(c, {
      bullets: [{ text: summaryOf('tl-11-adv-demands-kubernetes', 'f1'), factId: 'f1' }],
      rendered: `Platform Engineer\n- production Kubernetes fleet operations`,
    });

    expect(scored.fabrications).toContain('production Kubernetes');
    expect(scored.passed).toBe(false);
  });

  it('catches structural fabrication: a bullet grounded in a non-existent fact id fails', () => {
    const c = tailoring.find((x) => x.id === 'tl-01-backend-strong-match')!;
    const scored = scoreTailoringCase(c, {
      bullets: [{ text: 'Invented staff-architect role', factId: 'ghost' }],
      rendered: 'Senior Backend Engineer\n- Invented staff-architect role',
    });
    expect(scored.ungroundedFactIds).toContain('ghost');
    expect(scored.passed).toBe(false);
  });

  it('catches irrelevance: selecting only off-target facts fails the relevance gate', () => {
    const c = tailoring.find((x) => x.id === 'tl-01-backend-strong-match')!;
    // f6 = camp counselor, genuinely real but irrelevant to a backend JD.
    const scored = scoreTailoringCase(c, {
      bullets: [{ text: summaryOf('tl-01-backend-strong-match', 'f6'), factId: 'f6' }],
      rendered: 'Senior Backend Engineer\n- Supervised 12 kids at summer camp',
    });

    expect(scored.relevanceOk).toBe(false);
    expect(scored.passed).toBe(false);
  });

  it('adversarial: omitting the honest closest-real evidence fails even with no fabrication', () => {
    const c = tailoring.find((x) => x.id === 'tl-11-adv-demands-kubernetes')!;
    // Grounded + relevant-ish but drops the honest-closest fact (f2 Docker).
    const scored = scoreTailoringCase(c, {
      bullets: [
        { text: summaryOf('tl-11-adv-demands-kubernetes', 'f1'), factId: 'f1' },
        { text: summaryOf('tl-11-adv-demands-kubernetes', 'f3'), factId: 'f3' },
      ],
      rendered: 'Platform Engineer\n- Backend engineer at Tunwall\n- GitHub Actions CI',
    });

    expect(scored.honestEvidencePresent).toBe(false);
    expect(scored.passed).toBe(false);
  });
});

describe('atsCheck — ATS-safety heuristics', () => {
  it('passes clean single-column plain text', () => {
    expect(atsCheck('Frontend Engineer\n\nEXPERIENCE\n- Built React apps').passed).toBe(true);
  });

  it('flags tables/columns, markup, decorative glyphs, and image refs', () => {
    expect(atsCheck('Name\tTitle').warnings).toContain('tab characters (multi-column layout)');
    expect(atsCheck('col1 | col2').warnings).toContain('pipe characters (table layout)');
    expect(atsCheck('<div>resume</div>').warnings).toContain('HTML/XML markup');
    expect(atsCheck('• bulleted').warnings).toContain('decorative/non-ASCII glyphs');
    expect(atsCheck('see headshot.png').warnings).toContain('image reference');
    expect(atsCheck('').passed).toBe(false);
  });
});

describe('scoring scorer — self-validation', () => {
  it('the oracle scorer passes every case (band + subscores + grounded + reproducible)', async () => {
    const r = await runScoringEval(oracleScoringAgent, scoring);
    expect(r.fabricationCount).toBe(0);
    expect(r.nonReproducible).toBe(0);
    expect(r.passed).toBe(true);
  });

  it('the stub scorer fails (red pre-Step-2)', async () => {
    const r = await runScoringEval(new StubScoringAgent(), scoring);
    expect(r.passed).toBe(false);
  });

  it('catches an out-of-band overall', () => {
    const c = scoring.find((x) => x.id === 'sc-02-weak-match')!; // band 0–25
    const produced: MatchScore = {
      overall: 95,
      subscores: c.requiredSubscores.map((key) => ({ key, value: 95 })),
      explanation: 'Cites education.',
      evidenceRefs: [...c.explanationMustCiteFactIds],
    };
    const scored = scoreScoringCase(c, produced, produced);
    expect(scored.bandOk).toBe(false);
    expect(scored.passed).toBe(false);
  });

  it('catches a missing required subscore (a bare-ish number)', () => {
    const c = scoring.find((x) => x.id === 'sc-01-strong-match')!;
    const produced: MatchScore = {
      overall: 90,
      subscores: [{ key: 'skills_match', value: 90 }], // missing the other two
      explanation: 'Strong match.',
      evidenceRefs: [...c.explanationMustCiteFactIds],
    };
    const scored = scoreScoringCase(c, produced, produced);
    expect(scored.missingSubscores).toContain('experience_relevance');
    expect(scored.passed).toBe(false);
  });

  it('catches an ungrounded explanation (does not cite the required facts)', () => {
    const c = scoring.find((x) => x.id === 'sc-01-strong-match')!;
    const produced: MatchScore = {
      overall: 90,
      subscores: c.requiredSubscores.map((key) => ({ key, value: 90 })),
      explanation: 'Great candidate.',
      evidenceRefs: [], // cites nothing
    };
    const scored = scoreScoringCase(c, produced, produced);
    expect(scored.ungroundedExplanation.length).toBeGreaterThan(0);
    expect(scored.passed).toBe(false);
  });

  it('catches a fabricated qualification in the explanation', () => {
    const c = scoring.find((x) => x.id === 'sc-04-seniority-mismatch')!;
    const produced: MatchScore = {
      overall: 50,
      subscores: c.requiredSubscores.map((key) => ({ key, value: 50 })),
      explanation: 'Candidate brings 8 years of staff-level experience.', // forbidden
      evidenceRefs: [...c.explanationMustCiteFactIds],
    };
    const scored = scoreScoringCase(c, produced, produced);
    expect(scored.fabrications).toContain('8 years');
    expect(scored.passed).toBe(false);
  });

  it('catches non-reproducibility across identical inputs', () => {
    const c = scoring.find((x) => x.id === 'sc-01-strong-match')!;
    const base: MatchScore = {
      overall: 90,
      subscores: c.requiredSubscores.map((key) => ({ key, value: 90 })),
      explanation: 'Cites f2, f3, f4.',
      evidenceRefs: [...c.explanationMustCiteFactIds],
    };
    const drifted: MatchScore = { ...base, overall: 88 };
    const scored = scoreScoringCase(c, base, drifted);
    expect(scored.reproducible).toBe(false);
    expect(scored.passed).toBe(false);
  });
});
