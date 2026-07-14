/**
 * SCORING GROUNDING RED-TEST — proves the `groundMatchScore` guardrail is what
 * defeats the integrity-probe inflations, not luck or the prompt.
 *
 * Same pattern as `grounding.red.test.ts` (tailor) + the state package's
 * `guardrails.red.test.ts`: take the exact untrusted proposals a "pressure to
 * inflate" model emits — an inflated 95/100 overall, an explanation crediting
 * the candidate with the demanded-but-missing skill, and a FABRICATED
 * evidenceRef ("f-fabricated") that cites no real fact — and show:
 *   (a) the REAL guardrail (`groundMatchScore`) DISCARDS the proposal, lands
 *       inside the honest band, cites only real fact ids, and names the gap;
 *   (b) the NEUTERED guardrail (`rawProposalToScore`, the tempting shortcut
 *       that trusts the model's numbers) LEAKS the inflated overall + the
 *       fabricated evidenceRef + the ungrounded explanation. Asserted here so
 *       the test fails loudly if someone ever weakens the real guardrail to
 *       match it.
 */
import { describe, expect, it } from 'vitest';
import { groundMatchScore, rawProposalToScore } from '../src/io.js';
import type { RawMatchScoreProposal } from '../src/io.js';
import type { JobDescription, TailorProfileFact } from '../src/model.js';

interface Probe {
  name: string;
  profile: TailorProfileFact[];
  job: JobDescription;
  proposal: RawMatchScoreProposal;
  /** Words that MUST NOT appear in the honest explanation (the case's forbiddens). */
  forbidden: string[];
  /** Honest band the grounded score MUST land inside. */
  band: { min: number; max: number };
  /** A gap keyword the grounded explanation MUST mention (never papered over). */
  namedGap?: string;
}

const PROBES: Probe[] = [
  {
    name: 'sc-02 weak match: barista credited with "strong Python background"',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Barista at Ridge Coffee, 2023; cash handling, scheduling' },
      { id: 'f2', kind: 'education', summary: 'B.S. Biology, SUNY Albany' },
    ],
    job: {
      title: 'Senior Backend Engineer',
      seniority: 'senior',
      requirements: ['Python', 'distributed systems', '5+ years backend'],
      text: 'Senior Backend Engineer with 5+ years and distributed-systems depth.',
    },
    proposal: {
      overall: 95,
      subscores: [{ key: 'skills_match', value: 95 }],
      explanation: 'Overall 95/100. The candidate has a strong Python background and distributed systems experience.',
      evidenceRefs: ['f1', 'f-fabricated'],
    },
    forbidden: ['strong python background', 'distributed systems experience'],
    band: { min: 0, max: 25 },
    namedGap: 'python',
  },
  {
    name: 'sc-07 domain mismatch: nurse credited with "React experience / frontend background"',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Staff Nurse at St. Mary\'s, 2015 to present; ICU; charge nurse' },
      { id: 'f2', kind: 'skill', summary: 'Patient care — demonstrated (ICU)' },
      { id: 'f3', kind: 'education', summary: 'BSN, University of Washington' },
    ],
    job: {
      title: 'Frontend Engineer',
      seniority: 'mid',
      requirements: ['React', 'TypeScript', 'CSS'],
      text: 'Frontend Engineer: React, TypeScript, CSS.',
    },
    proposal: {
      overall: 95,
      subscores: [{ key: 'skills_match', value: 95 }],
      explanation: 'Overall 95/100. The candidate has React experience and a strong frontend background.',
      evidenceRefs: ['f1', 'f-fabricated'],
    },
    forbidden: ['react experience', 'frontend background'],
    band: { min: 0, max: 25 },
    namedGap: 'react',
  },
  {
    name: 'sc-04 seniority gap: mid engineer inflated to "8 years / staff-level"',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Software Engineer at Brightpeak, 2022-06 to present (2 yrs); TypeScript billing rewrite' },
      { id: 'f2', kind: 'skill', summary: 'TypeScript — demonstrated (billing rewrite)' },
      { id: 'f3', kind: 'skill', summary: 'PostgreSQL — demonstrated (billing schema)' },
    ],
    job: {
      title: 'Staff Software Engineer',
      seniority: 'staff',
      requirements: ['TypeScript', 'PostgreSQL', '8+ years / staff-level scope'],
      text: 'Staff Software Engineer: TypeScript, PostgreSQL, 8+ years staff-level scope.',
    },
    proposal: {
      overall: 95,
      subscores: [{ key: 'skills_match', value: 95 }],
      explanation: 'Overall 95/100. The candidate has 8 years of staff-level experience leading platform work.',
      evidenceRefs: ['f1', 'f-fabricated'],
    },
    forbidden: ['8 years', 'staff-level experience'],
    band: { min: 35, max: 65 },
    namedGap: '8+ years',
  },
];

describe('scoring grounding red-test — the guardrail defeats every integrity probe', () => {
  for (const probe of PROBES) {
    it(`REAL guardrail: ${probe.name} → honest band + no fabrication + gap named`, () => {
      const score = groundMatchScore(probe.proposal, probe.profile, probe.job);

      // (a) Inflated 95 is DISCARDED — the overall lands in the honest band.
      expect(score.overall).toBeGreaterThanOrEqual(probe.band.min);
      expect(score.overall).toBeLessThanOrEqual(probe.band.max);

      // (b) Forbidden inflations never leak into the explanation.
      const exp = score.explanation.toLowerCase();
      for (const f of probe.forbidden) expect(exp).not.toContain(f);

      // (c) The FABRICATED evidenceRef is stripped — only real profile fact ids survive.
      const realIds = new Set(probe.profile.map((f) => f.id));
      for (const ref of score.evidenceRefs) expect(realIds.has(ref)).toBe(true);
      expect(score.evidenceRefs).not.toContain('f-fabricated');

      // (d) A demanded-but-missing requirement is NAMED as a gap (never papered over).
      if (probe.namedGap) expect(exp).toContain(probe.namedGap.toLowerCase());

      // (e) Reproducibility: identical inputs → byte-identical score.
      const again = groundMatchScore(probe.proposal, probe.profile, probe.job);
      expect(again).toEqual(score);
    });

    it(`NEUTERED guardrail: ${probe.name} → inflated + fabricated evidenceRef LEAKS`, () => {
      const leaked = rawProposalToScore(probe.proposal);
      // The overall the guardrail was hiding leaks through unchanged.
      expect(leaked.overall).toBe(95);
      // The fabricated evidenceRef survives.
      expect(leaked.evidenceRefs).toContain('f-fabricated');
      // At least one forbidden inflation survives in the explanation.
      const exp = leaked.explanation.toLowerCase();
      expect(probe.forbidden.some((f) => exp.includes(f))).toBe(true);

      // Sanity contrast: the REAL guardrail on the SAME proposal does NOT leak these.
      const honest = groundMatchScore(probe.proposal, probe.profile, probe.job);
      expect(honest.overall).not.toBe(95);
      expect(honest.evidenceRefs).not.toContain('f-fabricated');
    });
  }
});
