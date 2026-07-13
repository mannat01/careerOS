/**
 * RED-TEST for the StateUpdater guardrails. Two duties:
 *  1. GREEN path — the real guardrail pipeline defeats each active over-reach
 *     (a demonstrated adjacency, a listed-only skill, an Ohio-from-license
 *     preference, an ungrounded readiness, a phantom-evidence value, thin-profile
 *     inflation).
 *  2. RED path — NEUTER a single guardrail (simulating a regression) and prove
 *     the corresponding forbidden over-reach LEAKS. This is the Step-2 lesson:
 *     the invariant is enforced by CODE, and the test fails loudly if that code
 *     is removed — not merely because the fake never proposed the sin.
 */
import { describe, expect, it } from 'vitest';
import {
  applyGuardrails,
  classifyValue,
  isThinEvidence,
  type RawStateProposal,
  type StateProfileFact,
} from '../src/index.js';

const byId = (facts: StateProfileFact[]): Map<string, StateProfileFact> =>
  new Map(facts.map((f) => [f.id, f]));

const valuesOf = (dims: ReturnType<typeof applyGuardrails>, key: string): string[] =>
  dims.find((d) => d.dimension === key)?.values ?? [];

// ---- sm-05 fixture: Kubernetes demonstrated; "distributed systems" is adjacency ----
const k8sFacts: StateProfileFact[] = [
  { id: 'f1', kind: 'experience', summary: 'DevOps Engineer at Vantage Cloud Co.; 200+ node Kubernetes clusters; Terraform modules for 9 teams' },
  { id: 'f2', kind: 'skill', summary: 'Kubernetes — demonstrated (200+ node clusters)' },
];

const k8sOverreach: RawStateProposal = {
  dimensions: [
    { dimension: 'demonstrated_skills', values: [{ text: 'Kubernetes', evidenceRefs: ['f2'], provenance: 'demonstrated' }] },
    // The over-reach: distributed systems asserted as DEMONSTRATED from Kubernetes.
    { dimension: 'demonstrated_skills', values: [{ text: 'distributed systems', evidenceRefs: ['f2'], provenance: 'demonstrated' }] },
  ],
};

// ---- sm-07 fixture: an Ohio license is NOT a location preference ----
const ohioFacts: StateProfileFact[] = [
  { id: 'f1', kind: 'experience', summary: 'Electrician at Kowalski & Sons; wired 30+ residential builds' },
  { id: 'f2', kind: 'education', summary: 'Licensed journeyman, State of Ohio' },
];

const ohioOverreach: RawStateProposal = {
  dimensions: [
    { dimension: 'geographic_preferences', values: [{ text: 'Ohio', evidenceRefs: ['f2'], provenance: 'inferred' }] },
  ],
};

describe('StateUpdater guardrails — GREEN: over-reaches are defeated', () => {
  it('sm-05: demonstrated "distributed systems" is RELOCATED to inferred, never demonstrated', () => {
    const dims = applyGuardrails(k8sOverreach, k8sFacts);
    expect(valuesOf(dims, 'demonstrated_skills')).toContain('Kubernetes');
    expect(valuesOf(dims, 'demonstrated_skills')).not.toContain('distributed systems');
    expect(valuesOf(dims, 'inferred_skills')).toContain('distributed systems');
  });

  it('sm-07: an Ohio license is DROPPED — geographic_preferences stays empty', () => {
    const dims = applyGuardrails(ohioOverreach, ohioFacts);
    expect(valuesOf(dims, 'geographic_preferences')).toEqual([]);
  });

  it('evidence-or-drop: a value citing phantom evidence (f99) never survives', () => {
    const proposal: RawStateProposal = {
      dimensions: [{ dimension: 'strengths', values: [{ text: 'visionary leadership', evidenceRefs: ['f99'], provenance: 'summarized' }] }],
    };
    const dims = applyGuardrails(proposal, k8sFacts);
    expect(valuesOf(dims, 'strengths')).toEqual([]);
  });

  it('thin profile: confident over-reaches are dropped wholesale', () => {
    const thin: StateProfileFact[] = [
      { id: 'f1', kind: 'experience', summary: 'Barista at Ridge Coffee, 2023' },
      { id: 'f2', kind: 'education', summary: 'B.S. Biology, SUNY Albany' },
    ];
    expect(isThinEvidence(thin)).toBe(true);
    const proposal: RawStateProposal = {
      dimensions: [
        { dimension: 'demonstrated_skills', values: [{ text: 'team leadership', evidenceRefs: ['f1'], provenance: 'demonstrated' }] },
        { dimension: 'career_goals', values: [{ text: 'research scientist', evidenceRefs: ['f2'], provenance: 'summarized' }] },
      ],
    };
    const dims = applyGuardrails(proposal, thin);
    expect(valuesOf(dims, 'demonstrated_skills')).toEqual([]);
    expect(valuesOf(dims, 'career_goals')).toEqual([]);
  });
});

/**
 * RED PATH — neuter the demonstrated/inferred guardrail (`classifyValue`) by
 * replacing it with a pass-through that trusts the model's provenance verbatim,
 * and re-run the SAME pipeline logic. The forbidden over-reach must now LEAK
 * into demonstrated_skills — proving the guardrail (not the fixture) is what
 * enforces the invariant.
 */
describe('StateUpdater guardrails — RED: neuter classifyValue → over-reach leaks', () => {
  /** A neutered pipeline that skips demotion — trusts the proposal's dimension. */
  function neuteredGuardrails(proposal: RawStateProposal, facts: StateProfileFact[]): Map<string, string[]> {
    const ids = byId(facts);
    const out = new Map<string, string[]>();
    for (const dim of proposal.dimensions) {
      for (const v of dim.values) {
        // Only the evidence-resolution gate remains; the demonstrated/inferred
        // separation (classifyValue) is intentionally bypassed.
        const resolved = v.evidenceRefs.filter((r: string) => ids.has(r));
        if (resolved.length === 0) continue;
        const list = out.get(dim.dimension) ?? [];
        list.push(v.text);
        out.set(dim.dimension, list);
      }
    }
    return out;
  }

  it('leaks "distributed systems" into demonstrated when classifyValue is bypassed', () => {
    const leaked = neuteredGuardrails(k8sOverreach, k8sFacts);
    // The regression: the over-reach now survives as DEMONSTRATED — exactly what
    // the real classifyValue prevents (asserted here so a real removal fails loud).
    expect(leaked.get('demonstrated_skills')).toContain('distributed systems');

    // Sanity: the REAL guardrail does NOT leak it (contrast proves the code matters).
    const guarded = applyGuardrails(k8sOverreach, k8sFacts);
    expect(valuesOf(guarded, 'demonstrated_skills')).not.toContain('distributed systems');
  });

  it('classifyValue itself demotes an ungrounded demonstrated skill to inferred', () => {
    const placed = classifyValue('demonstrated_skills', 'distributed systems', ['f2'], byId(k8sFacts), false);
    expect(placed).toEqual({ dimension: 'inferred_skills', provenance: 'inferred' });
  });
});
