/**
 * GapAnalyzer unit-integrity suite (M09 Step 3).
 *
 * Oracle: the deterministic analyzer's own output is integrity-clean — every
 * gap corresponds to a real demanded-but-missing skill, no gap names a skill
 * the user already demonstrates, every learning item links to a real gap.
 *
 * Fabricators: a candidate that INVENTS a gap, recommends learning a skill the
 * user ALREADY demonstrates, cites an unknown opportunity, or emits an
 * unlinked learning item is CAUGHT by the deterministic guardrail.
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeGaps,
  demonstratedSkills,
  verifyGapAnalysis,
  GapAnalyzerService,
  GAP_ANALYZER_MODEL_VERSION,
  type GapAnalysis,
  type GapAnalyzerInput,
} from '../src/index.js';

const INPUT: GapAnalyzerInput = {
  matches: [
    {
      opportunityId: 'opp-1',
      opportunityLabel: 'Acme — Senior SRE',
      subscores: [
        { key: 'skills', value: 55 },
        { key: 'experience', value: 80 },
      ],
      requiredSkills: ['Kubernetes', 'Terraform', 'Python'],
    },
    {
      // Strong match everywhere — must produce NO gaps.
      opportunityId: 'opp-2',
      opportunityLabel: 'Globex — Platform Engineer',
      subscores: [
        { key: 'skills', value: 90 },
        { key: 'experience', value: 85 },
      ],
      requiredSkills: ['Go', 'Kubernetes'],
    },
  ],
  stateModel: [
    { dimension: 'demonstrated_skills', values: ['Python', 'SQL'], confidence: 0.9 },
    { dimension: 'leadership_readiness', values: [], confidence: 0.2 },
    { dimension: 'communication_style', values: ['clear writer'], confidence: 0.8 },
  ],
  targetRoles: ['Senior SRE'],
};

describe('analyzeGaps (oracle)', () => {
  it('derives per-opp gaps only from demanded-but-missing skills on weak matches', () => {
    const analysis = analyzeGaps(INPUT);
    const perOpp = analysis.gaps.filter((g) => g.source === 'per_opp');
    const skills = perOpp.map((g) => g.skill).sort();
    // Python is demonstrated → excluded. opp-2 is strong → no gaps from it.
    expect(skills).toEqual(['kubernetes', 'terraform']);
    expect(perOpp.every((g) => g.opportunityId === 'opp-1')).toBe(true);
    expect(perOpp.every((g) => g.evidenceRefs.length > 0)).toBe(true);
  });

  it('derives aggregate gaps from low-confidence/absent dimensions vs target roles', () => {
    const analysis = analyzeGaps(INPUT);
    const agg = analysis.gaps.filter((g) => g.source === 'aggregate');
    const skills = agg.map((g) => g.skill).sort();
    // leadership_readiness weak (0.2), learning_velocity absent;
    // communication_style strong (0.8) → excluded.
    expect(skills).toEqual(['leadership_readiness', 'learning_velocity']);
    expect(agg.every((g) => g.opportunityId === undefined)).toBe(true);
  });

  it('emits no aggregate gaps when the user has no stated target roles', () => {
    const analysis = analyzeGaps({ ...INPUT, targetRoles: [] });
    expect(analysis.gaps.filter((g) => g.source === 'aggregate')).toEqual([]);
  });

  it('links every learning item to a real computed gap', () => {
    const analysis = analyzeGaps(INPUT);
    const keys = new Set(analysis.gaps.map((g) => g.key));
    expect(analysis.learningItems.length).toBe(analysis.gaps.length);
    for (const item of analysis.learningItems) expect(keys.has(item.gapKey)).toBe(true);
  });

  it('never names a demonstrated skill as a gap', () => {
    const analysis = analyzeGaps(INPUT);
    const demonstrated = demonstratedSkills(INPUT);
    for (const gap of analysis.gaps) expect(demonstrated.has(gap.skill)).toBe(false);
  });

  it('is integrity-clean against its own guardrail (oracle passes)', () => {
    expect(verifyGapAnalysis(analyzeGaps(INPUT), INPUT)).toEqual([]);
  });

  it('is deterministic (same input → identical output)', () => {
    expect(analyzeGaps(INPUT)).toEqual(analyzeGaps(INPUT));
  });
});

describe('verifyGapAnalysis (fabricators caught)', () => {
  it('catches an INVENTED gap no real demand supports', () => {
    const fabricated: GapAnalysis = {
      modelVersion: GAP_ANALYZER_MODEL_VERSION,
      gaps: [
        {
          key: 'per_opp:rust:opp-1',
          skill: 'rust',
          source: 'per_opp',
          opportunityId: 'opp-1',
          gap: 'You should learn Rust.',
          severity: 'high',
          evidenceRefs: [],
        },
      ],
      learningItems: [],
    };
    const violations = verifyGapAnalysis(fabricated, INPUT);
    expect(violations.map((v) => v.code)).toContain('invented_gap');
  });

  it('catches a gap for a skill the user ALREADY demonstrates', () => {
    const fabricated: GapAnalysis = {
      modelVersion: GAP_ANALYZER_MODEL_VERSION,
      gaps: [
        {
          key: 'per_opp:python:opp-1',
          skill: 'Python',
          source: 'per_opp',
          opportunityId: 'opp-1',
          gap: 'Learn Python.',
          severity: 'medium',
          evidenceRefs: [],
        },
      ],
      learningItems: [],
    };
    const violations = verifyGapAnalysis(fabricated, INPUT);
    expect(violations.map((v) => v.code)).toContain('already_demonstrated');
  });

  it('catches a gap citing an opportunity that is not among the real signals', () => {
    const fabricated: GapAnalysis = {
      modelVersion: GAP_ANALYZER_MODEL_VERSION,
      gaps: [
        {
          key: 'per_opp:kubernetes:opp-999',
          skill: 'kubernetes',
          source: 'per_opp',
          opportunityId: 'opp-999',
          gap: 'Kubernetes gap.',
          severity: 'medium',
          evidenceRefs: [],
        },
      ],
      learningItems: [],
    };
    const violations = verifyGapAnalysis(fabricated, INPUT);
    expect(violations.map((v) => v.code)).toContain('unknown_opportunity');
  });

  it('catches a learning item that does not link to a real gap', () => {
    const fabricated: GapAnalysis = {
      modelVersion: GAP_ANALYZER_MODEL_VERSION,
      gaps: [],
      learningItems: [
        {
          gapKey: 'per_opp:blockchain:opp-1',
          resource: { title: 'Blockchain Bootcamp', kind: 'course', effort: '8 weeks' },
        },
      ],
    };
    const violations = verifyGapAnalysis(fabricated, INPUT);
    expect(violations.map((v) => v.code)).toContain('unlinked_learning_item');
  });
});

describe('GapAnalyzerService (ports)', () => {
  it('gathers inputs via ports and returns the integrity-clean analysis', async () => {
    const service = new GapAnalyzerService({
      matches: { readMatchSignals: () => Promise.resolve(INPUT.matches) },
      state: { readStateDimensions: () => Promise.resolve(INPUT.stateModel) },
      targets: { readTargetRoles: () => Promise.resolve(INPUT.targetRoles) },
    });
    const analysis = await service.analyze('user-1');
    expect(analysis).toEqual(analyzeGaps(INPUT));
    expect(verifyGapAnalysis(analysis, INPUT)).toEqual([]);
  });
});