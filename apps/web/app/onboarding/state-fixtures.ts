import {
  cieStateExplainResponseSchema,
  cieStateResponseSchema,
  type CieDimensionKey,
  type CieStateExplainResponse,
  type CieStateResponse,
} from '@careeros/contracts';

const NOW = '2026-08-11T12:00:00.000Z';
const PROFILE_ID = '00000000-0000-4000-8000-000000000100';

export const POPULATED_STATE: CieStateResponse = cieStateResponseSchema.parse({
  profileId: PROFILE_ID,
  version: 1,
  updatedAt: NOW,
  dimensions: [
    {
      dimension: 'demonstrated_skills',
      value: { values: ['TypeScript'] },
      confidence: 0.9,
      provenance: 'demonstrated',
      evidenceRefs: ['skill:00000000-0000-4000-8000-000000000102'],
      freshnessAt: NOW,
      modelVersion: 'state-updater@1.0.0',
    },
    {
      dimension: 'inferred_skills',
      value: { values: ['Systems thinking'] },
      confidence: 0.65,
      provenance: 'inferred',
      evidenceRefs: ['experience:00000000-0000-4000-8000-000000000101'],
      freshnessAt: NOW,
      modelVersion: 'state-updater@1.0.0',
    },
    {
      dimension: 'leadership_readiness',
      value: { values: [] },
      confidence: 0,
      provenance: 'no-signal',
      evidenceRefs: [],
      freshnessAt: NOW,
      modelVersion: 'state-updater@1.0.0',
    },
  ],
});

export const NO_SIGNAL_STATE: CieStateResponse = cieStateResponseSchema.parse({
  profileId: PROFILE_ID,
  version: 1,
  updatedAt: NOW,
  dimensions: [
    {
      dimension: 'career_goals',
      value: { values: [] },
      confidence: 0,
      provenance: 'no-signal',
      evidenceRefs: [],
      freshnessAt: NOW,
      modelVersion: 'state-updater@1.0.0',
    },
  ],
});

export const CORRECTED_STATE: CieStateResponse = cieStateResponseSchema.parse({
  ...POPULATED_STATE,
  version: 2,
  dimensions: POPULATED_STATE.dimensions.map((dimension) =>
    dimension.dimension === 'demonstrated_skills'
      ? { ...dimension, value: { values: ['PostgreSQL'] }, confidence: 0.9 }
      : dimension,
  ),
});

export const STATE_EXPLANATIONS: Readonly<
  Partial<Record<CieDimensionKey, CieStateExplainResponse>>
> = Object.freeze({
  demonstrated_skills: cieStateExplainResponseSchema.parse({
    dimension: 'demonstrated_skills',
    values: ['TypeScript'],
    confidence: 0.9,
    provenance: 'demonstrated',
    reasoning: 'TypeScript is grounded in a profile skill fact.',
    evidence: [
      {
        ref: 'skill:00000000-0000-4000-8000-000000000102',
        kind: 'skill',
        label: 'TypeScript (intermediate)',
      },
    ],
  }),
  inferred_skills: cieStateExplainResponseSchema.parse({
    dimension: 'inferred_skills',
    values: ['Systems thinking'],
    confidence: 0.65,
    provenance: 'inferred',
    reasoning: 'Systems thinking is an inference grounded in the experience fact.',
    evidence: [
      {
        ref: 'experience:00000000-0000-4000-8000-000000000101',
        kind: 'experience',
        label: 'Senior Engineer at Acme',
      },
    ],
  }),
  leadership_readiness: cieStateExplainResponseSchema.parse({
    dimension: 'leadership_readiness',
    values: [],
    confidence: 0,
    provenance: 'no-signal',
    reasoning: 'No signal in the profile supports leadership readiness; left empty by design.',
    evidence: [],
  }),
  career_goals: cieStateExplainResponseSchema.parse({
    dimension: 'career_goals',
    values: [],
    confidence: 0,
    provenance: 'no-signal',
    reasoning: 'No signal in the profile supports career goals; left empty by design.',
    evidence: [],
  }),
});

export const CORRECTED_EXPLANATIONS: Readonly<
  Partial<Record<CieDimensionKey, CieStateExplainResponse>>
> = Object.freeze({
  ...STATE_EXPLANATIONS,
  demonstrated_skills: cieStateExplainResponseSchema.parse({
    dimension: 'demonstrated_skills',
    values: ['PostgreSQL'],
    confidence: 0.9,
    provenance: 'demonstrated',
    reasoning: 'PostgreSQL is grounded in the user-corrected profile skill fact.',
    evidence: [
      {
        ref: 'skill:00000000-0000-4000-8000-000000000102',
        kind: 'skill',
        label: 'PostgreSQL',
      },
    ],
  }),
});