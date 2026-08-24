import { describe, expect, it } from 'vitest';
import {
  pkmCreateRequestSchema,
  pkmEntrySchema,
  pkmListResponseSchema,
  pkmUpdateRequestSchema,
} from '../src/index.js';

const ENTRY = {
  id: '00000000-0000-4000-8000-000000000111',
  userId: '00000000-0000-4000-8000-000000000112',
  title: 'Architecture notes',
  body: 'Prefer reversible migrations.',
  tags: ['architecture'],
  provenance: 'user' as const,
  createdAt: '2026-08-24T12:00:00.000Z',
  updatedAt: '2026-08-24T12:00:00.000Z',
};

describe('PKM contracts', () => {
  it('strictly parses the persisted entry and list envelope', () => {
    expect(pkmEntrySchema.parse(ENTRY)).toEqual(ENTRY);
    expect(pkmListResponseSchema.parse({ data: [ENTRY] })).toEqual({ data: [ENTRY] });
    expect(pkmEntrySchema.safeParse({ ...ENTRY, internal: true }).success).toBe(false);
    expect(pkmListResponseSchema.safeParse({ items: [ENTRY] }).success).toBe(false);
  });

  it('accepts the exact create shape with optional tags', () => {
    expect(pkmCreateRequestSchema.parse({ title: 'Note', body: 'Body' })).toEqual({ title: 'Note', body: 'Body' });
    expect(pkmCreateRequestSchema.parse({ title: 'Note', body: 'Body', tags: ['career'] })).toEqual({
      title: 'Note', body: 'Body', tags: ['career'],
    });
  });

  it.each(['userId', 'provenance'])('rejects client-controlled %s on create and update', (field) => {
    expect(pkmCreateRequestSchema.safeParse({ title: 'Note', body: 'Body', [field]: 'user' }).success).toBe(false);
    expect(pkmUpdateRequestSchema.safeParse({ title: 'Note', [field]: 'user' }).success).toBe(false);
  });

  it('accepts non-empty partial updates and rejects empty/invalid input', () => {
    expect(pkmUpdateRequestSchema.parse({ body: 'Updated' })).toEqual({ body: 'Updated' });
    expect(pkmUpdateRequestSchema.safeParse({}).success).toBe(false);
    expect(pkmCreateRequestSchema.safeParse({ title: '', body: '' }).success).toBe(false);
    expect(pkmUpdateRequestSchema.safeParse({ tags: [''] }).success).toBe(false);
  });
});