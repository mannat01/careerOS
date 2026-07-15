import { z } from 'zod';

/**
 * Application pipeline contracts — M04 Stage 4 (database-schema.md §application,
 * api-spec.md §Application). An Application is a per-user CRM record binding the
 * caller to an Opportunity (and, optionally, a tailored resume variant) as they
 * move it through a fixed status pipeline.
 *
 * CORE invariant surfaced here: the pipeline advances through an ordered set of
 * statuses, and the transition to `applied` is a HUMAN-IN-THE-LOOP consequence —
 * it demands an explicit "I submitted this" flag on the PATCH and may NEVER be set
 * by an agent/system context. The state-machine + guard that enforce this live in
 * apps/api (status-machine.ts); these are the wire shapes both sides validate.
 */

/**
 * The fixed pipeline, in order:
 *   saved → drafting → ready → applied → screening → interviewing → offer → closed
 * `closed` is reachable from any non-terminal state (drop / reject at any stage).
 */
export const applicationStatusSchema = z.enum([
  'saved',
  'drafting',
  'ready',
  'applied',
  'screening',
  'interviewing',
  'offer',
  'closed',
]);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

/** Who drove a status change — mirrors AuditActor (user | twin | system). */
export const applicationActorSchema = z.enum(['user', 'twin', 'system']);
export type ApplicationActor = z.infer<typeof applicationActorSchema>;

/**
 * POST /v1/applications — create a pipeline record. Status defaults to `saved`
 * server-side; the body only links an opportunity (+ an optional resume variant)
 * and may seed a note. The owning user comes ONLY from the verified context.
 */
export const applicationCreateRequestSchema = z.object({
  opportunityId: z.string().uuid(),
  resumeVariantId: z.string().min(1).optional(),
  notes: z.string().max(10_000).optional(),
});
export type ApplicationCreateRequest = z.infer<typeof applicationCreateRequestSchema>;

/**
 * PATCH /v1/applications/:id — move status and/or edit notes/follow-up. Every
 * field is optional (a notes-only edit performs no transition).
 *
 * `iSubmitted` is the REQUIRED explicit "I submitted this" flag for the
 * `applied` transition: the system prepares, the user submits. It is meaningful
 * ONLY when `status: 'applied'`; on any other transition it is ignored.
 */
export const applicationPatchRequestSchema = z
  .object({
    status: applicationStatusSchema.optional(),
    notes: z.string().max(10_000).optional(),
    followUpAt: z.string().datetime().nullable().optional(),
    /** Explicit user submit acknowledgement — gates the `applied` transition. */
    iSubmitted: z.boolean().optional(),
  })
  .refine((v) => v.status !== undefined || v.notes !== undefined || v.followUpAt !== undefined, {
    message: 'PATCH must change at least one of: status, notes, followUpAt.',
  });
export type ApplicationPatchRequest = z.infer<typeof applicationPatchRequestSchema>;

/**
 * POST /v1/applications/:id/followups — schedule an INTERNAL reminder (Green; no
 * external send ever leaves the system). Just a due date + an optional note.
 */
export const applicationFollowUpRequestSchema = z.object({
  dueAt: z.string().datetime(),
  note: z.string().max(2_000).optional(),
});
export type ApplicationFollowUpRequest = z.infer<typeof applicationFollowUpRequestSchema>;

// ---------------- response shapes ----------------

export const applicationTimelineEntrySchema = z.object({
  id: z.string(),
  fromStatus: applicationStatusSchema.nullable(),
  toStatus: applicationStatusSchema,
  actor: applicationActorSchema,
  note: z.string().nullable(),
  at: z.string().datetime(),
});
export type ApplicationTimelineEntry = z.infer<typeof applicationTimelineEntrySchema>;

export const applicationSchema = z.object({
  id: z.string(),
  opportunityId: z.string(),
  resumeVariantId: z.string().nullable(),
  status: applicationStatusSchema,
  notes: z.string().nullable(),
  followUpAt: z.string().datetime().nullable(),
  appliedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Application = z.infer<typeof applicationSchema>;

/** Application detail = the record plus its status-change timeline (newest last). */
export const applicationDetailSchema = applicationSchema.extend({
  timeline: z.array(applicationTimelineEntrySchema),
});
export type ApplicationDetail = z.infer<typeof applicationDetailSchema>;

export const applicationFollowUpSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  dueAt: z.string().datetime(),
  note: z.string().nullable(),
  done: z.boolean(),
  createdAt: z.string().datetime(),
});
export type ApplicationFollowUp = z.infer<typeof applicationFollowUpSchema>;
