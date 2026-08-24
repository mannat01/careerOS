import { z } from 'zod';

const pkmTitleSchema = z.string().trim().min(1).max(200);
const pkmBodySchema = z.string().trim().min(1).max(50_000);
const pkmTagsSchema = z.array(z.string().trim().min(1).max(32)).max(16);

/** Caller-owned PKM entry. Provenance is server-controlled and always user-authored. */
export const pkmEntrySchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    title: pkmTitleSchema,
    body: pkmBodySchema,
    tags: pkmTagsSchema,
    provenance: z.literal('user'),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type PkmEntry = z.infer<typeof pkmEntrySchema>;

/** POST /v1/pkm. userId and provenance are deliberately absent and rejected. */
export const pkmCreateRequestSchema = z
  .object({
    title: pkmTitleSchema,
    body: pkmBodySchema,
    tags: pkmTagsSchema.optional(),
  })
  .strict();
export type PkmCreateRequest = z.infer<typeof pkmCreateRequestSchema>;

/** PATCH /v1/pkm/:id. At least one caller-editable field must be supplied. */
export const pkmUpdateRequestSchema = pkmCreateRequestSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'PATCH must change at least one of: title, body, tags.',
  });
export type PkmUpdateRequest = z.infer<typeof pkmUpdateRequestSchema>;

export const pkmListResponseSchema = z
  .object({ data: z.array(pkmEntrySchema) })
  .strict();
export type PkmListResponse = z.infer<typeof pkmListResponseSchema>;