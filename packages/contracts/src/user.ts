import { z } from 'zod';
import { autonomyTierSchema, type AutonomyTier } from './autonomy.js';

/** identity DTOs — database-schema.md §2 (identity), api-spec.md §4 (Auth & account). */

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  authProviderId: z.string().min(1),
  subscriptionTier: z.enum(['free', 'pro']),
  status: z.enum(['active', 'suspended', 'deleted']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type User = z.infer<typeof userSchema>;

export const quietHoursSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM'),
  end: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM'),
  timezone: z.string().min(1),
});

export const briefingScheduleSchema = z.object({
  cron: z.string().min(1),
  timezone: z.string().min(1),
});

export const dataUseOptInsSchema = z.object({
  training: z.boolean(),
  crossUserIntel: z.boolean(),
});

export const userSettingsSchema = z.object({
  userId: z.string().uuid(),
  /** Per action-type Green/Yellow/Red overrides; may only tighten the registry tier. */
  autonomyDefaults: z.record(z.string().min(1), autonomyTierSchema),
  quietHours: quietHoursSchema.nullable(),
  briefingSchedule: briefingScheduleSchema.nullable(),
  sourcePrefs: z.record(z.string().min(1), z.boolean()),
  dataUseOptIns: dataUseOptInsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

/**
 * Conservative autonomy defaults (milestone-01.md acceptance; coding-standards.md §8:
 * "Autonomy defaults ship conservative"). Anything with an external side effect starts
 * Yellow; Red actions are listed for visibility but no setting can ever enable them.
 */
export const CONSERVATIVE_AUTONOMY_DEFAULTS: Readonly<Record<string, AutonomyTier>> =
  Object.freeze({
    'research.run': 'green',
    'opportunity.ingest': 'green',
    'opportunity.score': 'green',
    'resume.tailor': 'green',
    'draft.create': 'green',
    'gap.analyze': 'green',
    'briefing.generate': 'green',
    'memory.write': 'green',
    'me.export': 'green',
    'draft.send': 'yellow',
    'application.submit_assist': 'yellow',
    'portfolio.publish': 'yellow',
    'me.delete': 'yellow',
    'account.third_party_auth': 'red',
    'offer.accept': 'red',
    'offer.decline': 'red',
  });

/** Factory for a brand-new user's settings: conservative everywhere, all opt-ins OFF. */
export function defaultUserSettings(userId: string, nowIso: string): UserSettings {
  return {
    userId,
    autonomyDefaults: { ...CONSERVATIVE_AUTONOMY_DEFAULTS },
    quietHours: null,
    briefingSchedule: null, // manual briefings only until the user opts in
    sourcePrefs: {},
    dataUseOptIns: { training: false, crossUserIntel: false },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/** GET /v1/me response. */
export const meResponseSchema = z.object({
  user: userSchema,
  settings: userSettingsSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** PATCH /v1/me/settings body — strict: unknown keys are rejected at the boundary. */
export const updateUserSettingsRequestSchema = z
  .object({
    autonomyDefaults: z.record(z.string().min(1), autonomyTierSchema),
    quietHours: quietHoursSchema.nullable(),
    briefingSchedule: briefingScheduleSchema.nullable(),
    sourcePrefs: z.record(z.string().min(1), z.boolean()),
    dataUseOptIns: dataUseOptInsSchema.partial(),
  })
  .partial()
  .strict();
export type UpdateUserSettingsRequest = z.infer<typeof updateUserSettingsRequestSchema>;
