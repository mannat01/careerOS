import { z } from 'zod';

/**
 * Profile-import DTOs — api-spec.md §5 (`POST /v1/profile/import`).
 *
 * The endpoint accepts EITHER raw resume text (extracted by the cheap-tier
 * agent) OR an already-parsed entity payload (used when an upstream job already
 * ran extraction). Real binary PDF/DOCX parsing is STUB(M02) — the sandbox
 * slice works on text + parsed payloads only.
 *
 * Every persisted profile fact carries provenance (a verbatim source quote),
 * per the zero-fabrication + provenance invariants (CLAUDE.md §3.4–3.5).
 */

export const provenanceSchema = z.object({
  source: z.literal('resume'),
  quote: z.string().min(1),
});
export type ProfileProvenance = z.infer<typeof provenanceSchema>;

/** A single parsed entity in the "already-parsed payload" import path. */
export const parsedEntitySchema = z.object({
  kind: z.enum(['experience', 'project', 'education', 'skill']),
  name: z.string().min(1),
  detail: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  credential: z.string().optional(),
  field: z.string().optional(),
  evidence: z.enum(['demonstrated', 'claimed']).optional(),
  skills: z.array(z.string()).optional(),
  provenance: provenanceSchema,
});
export type ParsedEntity = z.infer<typeof parsedEntitySchema>;

/**
 * Import request — exactly one of `resumeText` | `entities`. `resumeText` runs
 * the extraction agent; `entities` skips it (already parsed upstream).
 */
export const profileImportRequestSchema = z
  .object({
    resumeText: z.string().min(1).optional(),
    entities: z.array(parsedEntitySchema).min(1).optional(),
  })
  .refine((v) => (v.resumeText === undefined) !== (v.entities === undefined), {
    message: 'Provide exactly one of resumeText or entities.',
  });
export type ProfileImportRequest = z.infer<typeof profileImportRequestSchema>;

/** A persisted profile fact echoed back to the caller (with its provenance). */
export const importedEntitySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['experience', 'project', 'education', 'skill']),
  name: z.string(),
  detail: z.string().optional(),
  provenance: provenanceSchema,
});
export type ImportedEntity = z.infer<typeof importedEntitySchema>;

export const profileImportResponseSchema = z.object({
  profileId: z.string().uuid(),
  counts: z.object({
    experiences: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative(),
    education: z.number().int().nonnegative(),
    skillClaims: z.number().int().nonnegative(),
  }),
  entities: z.array(importedEntitySchema),
});
export type ProfileImportResponse = z.infer<typeof profileImportResponseSchema>;

/**
 * Authoritative correction of one existing profile fact. The kind is explicit
 * so one route can safely address the four kind-specific profile tables without
 * guessing from an id. This small correction slice edits the fact's canonical
 * display label; richer field-level CRUD can extend the discriminated request.
 */
export const profileFactKindSchema = z.enum(['experience', 'project', 'education', 'skill']);
export type ProfileFactKind = z.infer<typeof profileFactKindSchema>;

export const profileFactEditRequestSchema = z
  .object({
    kind: profileFactKindSchema,
    label: z.string().trim().min(1).max(500),
  })
  .strict();
export type ProfileFactEditRequest = z.infer<typeof profileFactEditRequestSchema>;

export const editedProfileFactSchema = z
  .object({
    id: z.string().uuid(),
    kind: profileFactKindSchema,
    label: z.string().min(1),
    detail: z.string().nullable(),
    provenance: z.literal('user'),
  })
  .strict();
export type EditedProfileFact = z.infer<typeof editedProfileFactSchema>;

export const profileFactEditResponseSchema = z
  .object({ fact: editedProfileFactSchema })
  .strict();
export type ProfileFactEditResponse = z.infer<typeof profileFactEditResponseSchema>;

/** Existing profile projection returned by GET /v1/profile. */
const storedProvenanceSchema = z.enum(['imported', 'user', 'inferred_confirmed']);
const storedFactSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  detail: z.string().nullable(),
  provenance: storedProvenanceSchema,
});

export const profileResponseSchema = z.object({
  id: z.string().uuid(),
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  targetRoles: z.array(z.string()),
  locations: z.array(z.string()),
  remotePreference: z.string().nullable(),
  goals: z.array(z.string()),
  experiences: z.array(storedFactSchema),
  projects: z.array(storedFactSchema),
  education: z.array(storedFactSchema),
  skills: z.array(storedFactSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
