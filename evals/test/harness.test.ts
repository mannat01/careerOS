/**
 * Harness self-tests — prove the scorer can (a) pass a perfect agent,
 * (b) fail a fabricating agent, (c) fail missing provenance, (d) fail
 * confidence/evidence violations. If the scorer can't catch these, the eval
 * gate is decorative.
 */
import { describe, expect, it } from 'vitest';
import {
  expectedName,
  runExtractionEval,
  runStateModelEval,
  scoreExtractionCase,
  scoreStateModelCase,
} from '../src/harness.js';
import { loadExtractionCases, loadStateModelCases } from '../src/datasets.js';
import { StubExtractionAgent, StubStateModelAgent } from '../src/stub-agents.js';
import type { DerivedDimension, ExtractedEntity, ExtractionAgent, StateModelAgent } from '../src/types.js';

/** Oracle agent: answers straight from the golden labels (perfect by construction). */
const oracleExtractor: ExtractionAgent = {
  extract(resumeText: string) {
    const c = loadExtractionCases().find((x) => x.resumeText === resumeText);
    if (!c) return Promise.resolve([]);
    return Promise.resolve(
      c.expected.map(
        (e): ExtractedEntity => ({ kind: e.kind, name: expectedName(e), provenance: e.provenance }),
      ),
    );
  },
};

const oracleStateAgent: StateModelAgent = {
  derive(profile) {
    const c = loadStateModelCases().find((x) => x.profile === profile);
    if (!c) return Promise.resolve([]);
    return Promise.resolve(
      c.expected.map(
        (d): DerivedDimension => ({
          dimension: d.dimension,
          values: [...d.mustInclude],
          confidence: (d.confidence.min + d.confidence.max) / 2,
          evidenceRefs: [...d.evidenceRefs],
        }),
      ),
    );
  },
};

describe('extraction scorer', () => {
  it('a perfect (oracle) agent passes every case with 100% recall', async () => {
    const r = await runExtractionEval(oracleExtractor, loadExtractionCases());
    expect(r.overallRecall).toBe(1);
    expect(r.fabricationCount).toBe(0);
    expect(r.passed).toBe(true);
  });

  it('the stub agent scores 0 recall and fails (the gate is red pre-Step-2)', async () => {
    const r = await runExtractionEval(new StubExtractionAgent(), loadExtractionCases());
    expect(r.overallRecall).toBe(0);
    expect(r.passed).toBe(false);
  });

  it('catches fabrication: emitting a forbidden credential fails the adversarial case', () => {
    const adv = loadExtractionCases().find((c) => c.id === 'ext-13-adv-aws-familiarity')!;
    const honest = adv.expected.map(
      (e): ExtractedEntity => ({ kind: e.kind, name: expectedName(e), provenance: e.provenance }),
    );
    const inflated: ExtractedEntity[] = [
      ...honest,
      {
        kind: 'education',
        name: 'AWS Certified Solutions Architect',
        provenance: { source: 'resume', quote: 'Familiar with AWS concepts and studying for the Solutions Architect certification.' },
      },
    ];
    const r = scoreExtractionCase(adv, inflated);
    expect(r.fabrications).toContain('AWS Certified Solutions Architect');
    expect(r.passed).toBe(false);
  });

  it('catches invented provenance: a quote not present verbatim in the source fails', () => {
    const c = loadExtractionCases().find((x) => x.id === 'ext-01-chronological-swe')!;
    const r = scoreExtractionCase(c, [
      { kind: 'skill', name: 'Python', provenance: { source: 'resume', quote: 'expert Python architect since 2010' } },
    ]);
    expect(r.provenanceViolations).toContain('skill:Python');
    expect(r.passed).toBe(false);
  });

  it('catches missing provenance entirely', () => {
    const c = loadExtractionCases().find((x) => x.id === 'ext-01-chronological-swe')!;
    const r = scoreExtractionCase(c, [{ kind: 'skill', name: 'Python' }]);
    expect(r.provenanceViolations).toContain('skill:Python');
  });
});

describe('state-model scorer', () => {
  it('a perfect (oracle) agent passes every case', async () => {
    const r = await runStateModelEval(oracleStateAgent, loadStateModelCases());
    expect(r.fabricationCount).toBe(0);
    expect(r.passed).toBe(true);
  });

  it('the stub agent fails (red pre-Step-2)', async () => {
    const r = await runStateModelEval(new StubStateModelAgent(), loadStateModelCases());
    expect(r.passed).toBe(false);
  });

  it('catches an inferred skill smuggled into demonstrated_skills', () => {
    const c = loadStateModelCases().find((x) => x.id === 'sm-05-inferred-vs-demonstrated-adjacency')!;
    const r = scoreStateModelCase(c, [
      { dimension: 'demonstrated_skills', values: ['Kubernetes', 'Terraform', 'distributed systems'], confidence: 0.8, evidenceRefs: ['f2', 'f3'] },
      { dimension: 'inferred_skills', values: ['distributed systems'], confidence: 0.4, evidenceRefs: ['f2'] },
    ]);
    const dim = r.dimensions.find((d) => d.dimension === 'demonstrated_skills')!;
    expect(dim.intruded).toContain('distributed systems');
    expect(r.passed).toBe(false);
  });

  it('catches overconfidence on thin evidence', () => {
    const c = loadStateModelCases().find((x) => x.id === 'sm-02-new-grad-thin-evidence')!;
    const r = scoreStateModelCase(c, [
      { dimension: 'demonstrated_skills', values: [], confidence: 0.9, evidenceRefs: [] },
      { dimension: 'career_goals', values: [], confidence: 0.1, evidenceRefs: [] },
    ]);
    const dim = r.dimensions.find((d) => d.dimension === 'demonstrated_skills')!;
    expect(dim.confidenceOk).toBe(false);
    expect(r.passed).toBe(false);
  });

  it('catches missing evidence links', () => {
    const c = loadStateModelCases().find((x) => x.id === 'sm-08-evidence-links-required')!;
    const r = scoreStateModelCase(c, [
      { dimension: 'demonstrated_skills', values: ['Paid acquisition', 'A/B testing'], confidence: 0.8, evidenceRefs: [] },
      { dimension: 'strengths', values: ['growth marketing'], confidence: 0.7, evidenceRefs: ['f1'] },
      { dimension: 'leadership_readiness', values: [], confidence: 0.2, evidenceRefs: [] },
    ]);
    const dim = r.dimensions.find((d) => d.dimension === 'demonstrated_skills')!;
    expect(dim.evidenceOk).toBe(false);
    expect(r.passed).toBe(false);
  });

  it('catches fabricated dimension values via forbidden strings', () => {
    const c = loadStateModelCases().find((x) => x.id === 'sm-07-no-ungrounded-dimensions')!;
    const r = scoreStateModelCase(c, [
      { dimension: 'demonstrated_skills', values: ['Residential wiring'], confidence: 0.8, evidenceRefs: ['f1'] },
      { dimension: 'compensation_goals', values: ['$85,000 target salary'], confidence: 0.1, evidenceRefs: [] },
      { dimension: 'geographic_preferences', values: [], confidence: 0.1, evidenceRefs: [] },
    ]);
    expect(r.fabrications).toContain('$');
    expect(r.passed).toBe(false);
  });
});
