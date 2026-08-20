import { describe, expect, it } from 'vitest';
import {
  skillGapSchema,
  skillGapsQuerySchema,
  skillGapsResponseSchema,
} from '../src/index.js';

const GAP_ID = '00000000-0000-4000-8000-000000000064';
const OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000065';
const COMPUTED_AT = '2026-08-20T12:00:00.000Z';

describe('FM6.4-pre public skills-gap contracts', () => {
  it('strictly parses the optional opportunity-scoping query', () => {
    expect(skillGapsQuerySchema.parse({})).toEqual({});
    expect(skillGapsQuerySchema.parse({ opportunityId: OPPORTUNITY_ID })).toEqual({
      opportunityId: OPPORTUNITY_ID,
    });
    expect(skillGapsQuerySchema.safeParse({ opportunityId: 'not-a-uuid' }).success).toBe(false);
    expect(skillGapsQuerySchema.safeParse({ userId: GAP_ID }).success).toBe(false);
  });

  it('strictly parses a grounded per-opportunity gap with typed provenance and no confidence', () => {
    const gap = {
      id: GAP_ID,
      skill: 'kubernetes',
      gap: 'Kubernetes is required by the selected role but is not demonstrated.',
      severity: 'high' as const,
      source: 'per_opp' as const,
      opportunityId: OPPORTUNITY_ID,
      evidenceRefs: [
        {
          kind: 'opportunity_requirement' as const,
          opportunityId: OPPORTUNITY_ID,
          requirement: 'kubernetes',
        },
        {
          kind: 'match_subscore' as const,
          opportunityId: OPPORTUNITY_ID,
          key: 'skills',
          value: 31,
        },
      ],
      modelVersion: 'gap-analyzer@1.0.0',
      computedAt: COMPUTED_AT,
    };

    expect(skillGapSchema.parse(gap)).toEqual(gap);
    expect(skillGapSchema.safeParse({ ...gap, confidence: 0.8 }).success).toBe(false);
    expect(skillGapSchema.safeParse({ ...gap, severity: 'critical' }).success).toBe(false);
    expect(skillGapSchema.safeParse({ ...gap, evidenceRefs: [gap.evidenceRefs[0]] }).success).toBe(false);
    expect(skillGapSchema.safeParse({
      ...gap,
      evidenceRefs: gap.evidenceRefs.map((ref) => ({ ...ref, opportunityId: GAP_ID })),
    }).success).toBe(false);
  });

  it('strictly parses an aggregate gap grounded in a state dimension and stated role', () => {
    const gap = {
      id: GAP_ID,
      skill: 'leadership_readiness',
      gap: 'Your leadership-readiness signal is weak relative to your stated target role.',
      severity: 'medium' as const,
      source: 'aggregate' as const,
      opportunityId: null,
      evidenceRefs: [
        { kind: 'state_dimension' as const, dimension: 'leadership_readiness', signal: 'weak' as const },
        { kind: 'target_role' as const, role: 'Engineering Manager' },
      ],
      modelVersion: 'gap-analyzer@1.0.0',
      computedAt: COMPUTED_AT,
    };

    expect(skillGapSchema.parse(gap)).toEqual(gap);
    expect(skillGapSchema.safeParse({ ...gap, opportunityId: OPPORTUNITY_ID }).success).toBe(false);
  });

  it('distinguishes analyzed-with-no-gaps from insufficient data', () => {
    expect(skillGapsResponseSchema.parse({ status: 'ok', gaps: [] })).toEqual({
      status: 'ok',
      gaps: [],
    });
    expect(skillGapsResponseSchema.parse({ status: 'insufficient_data' })).toEqual({
      status: 'insufficient_data',
    });
    expect(skillGapsResponseSchema.safeParse({ status: 'insufficient_data', gaps: [] }).success).toBe(false);
    expect(skillGapsResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
  });
});