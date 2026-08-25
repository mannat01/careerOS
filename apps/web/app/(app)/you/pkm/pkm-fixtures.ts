import { pkmDeleteResponseSchema, pkmEntrySchema, pkmListResponseSchema } from '@careeros/contracts';

export const PKM_ENTRY_ID = '00000000-0000-4000-8000-000000000181';
export const PKM_USER_ID = '00000000-0000-4000-8000-000000000182';

export const PKM_ENTRY = pkmEntrySchema.parse({
  id: PKM_ENTRY_ID,
  userId: PKM_USER_ID,
  title: 'Platform notes',
  body: 'Prefer reversible migrations.\nMeasure operational impact.',
  tags: ['platform', 'architecture'],
  provenance: 'user',
  createdAt: '2026-08-24T12:00:00.000Z',
  updatedAt: '2026-08-24T13:30:00.000Z',
});

export const UPDATED_PKM_ENTRY = pkmEntrySchema.parse({
  ...PKM_ENTRY,
  title: 'Updated platform notes',
  tags: ['platform', 'postgres'],
  updatedAt: '2026-08-24T14:00:00.000Z',
});

export const CREATED_PKM_ENTRY = pkmEntrySchema.parse({
  id: '00000000-0000-4000-8000-000000000183',
  userId: PKM_USER_ID,
  title: 'Interview reflection',
  body: 'Ask for concrete examples.',
  tags: ['interview'],
  provenance: 'user',
  createdAt: '2026-08-24T15:00:00.000Z',
  updatedAt: '2026-08-24T15:00:00.000Z',
});

export const POPULATED_PKM = pkmListResponseSchema.parse({ data: [PKM_ENTRY] });
export const EMPTY_PKM = pkmListResponseSchema.parse({ data: [] });
export const DELETED_PKM_ENTRY = pkmDeleteResponseSchema.parse({ id: PKM_ENTRY_ID, deleted: true });