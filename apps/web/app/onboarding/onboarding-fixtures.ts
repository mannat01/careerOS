import {
  profileImportResponseSchema,
  type ProfileImportResponse,
} from '@careeros/contracts';

export const POPULATED_IMPORT: ProfileImportResponse = profileImportResponseSchema.parse({
  profileId: '00000000-0000-4000-8000-000000000100',
  counts: { experiences: 1, projects: 1, education: 1, skillClaims: 1 },
  entities: [
    {
      id: '00000000-0000-4000-8000-000000000101',
      kind: 'experience',
      name: 'Senior Engineer at Acme',
      detail: 'Built distributed pipelines.',
      provenance: {
        source: 'resume',
        quote: 'Senior Engineer at Acme — built distributed pipelines.',
      },
    },
    {
      id: '00000000-0000-4000-8000-000000000102',
      kind: 'skill',
      name: 'TypeScript',
      provenance: { source: 'resume', quote: 'Skills: TypeScript, Python' },
    },
    {
      id: '00000000-0000-4000-8000-000000000103',
      kind: 'education',
      name: 'B.S. Computer Science',
      provenance: { source: 'resume', quote: 'B.S. Computer Science, 2016' },
    },
    {
      id: '00000000-0000-4000-8000-000000000104',
      kind: 'project',
      name: 'Open source scheduler',
      provenance: { source: 'resume', quote: 'Created an open source scheduler.' },
    },
  ],
});

export const THIN_IMPORT: ProfileImportResponse = profileImportResponseSchema.parse({
  profileId: '00000000-0000-4000-8000-000000000100',
  counts: { experiences: 0, projects: 0, education: 0, skillClaims: 0 },
  entities: [],
});