import {
  defaultUserSettings,
  meResponseSchema,
  updateUserSettingsRequestSchema,
  userSettingsSchema,
  type MeResponse,
  type UserSettings,
} from '@careeros/contracts';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';
import type { RequestContext } from '../../common/auth/request-context.js';
import { assertUserScope } from '../../common/auth/scope.js';
import type { UserLifecycleRepo, UserRepo, UserSettingsRepo } from './repos.js';

export interface IdentityDeps {
  users: UserRepo;
  settings: UserSettingsRepo;
  lifecycle: UserLifecycleRepo;
  clock?: () => Date;
}

const nowIso = (deps: IdentityDeps): string => (deps.clock ?? (() => new Date()))().toISOString();

/** GET /v1/me — user + settings; first read provisions conservative defaults. */
export async function getMe(
  ctx: RequestContext,
  deps: IdentityDeps,
): Promise<HandlerResponse<MeResponse>> {
  const user = await deps.users.findById(ctx.userId);
  if (user === null) {
    return errorResponse('not_found', 'User not found.', { traceId: ctx.traceId });
  }
  assertUserScope(ctx.userId, user.id);

  let settings = await deps.settings.findByUserId(ctx.userId);
  if (settings === null) {
    settings = await deps.settings.save(defaultUserSettings(ctx.userId, nowIso(deps)));
  }

  // Contract test in-line: the response must validate against the shared schema.
  return ok(meResponseSchema.parse({ user, settings }));
}

/** PATCH /v1/me/settings — boundary-validated partial update (Green). */
export async function patchMeSettings(
  ctx: RequestContext,
  body: unknown,
  deps: IdentityDeps,
): Promise<HandlerResponse<UserSettings>> {
  const parsed = updateUserSettingsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('validation_failed', 'Invalid settings payload.', {
      details: { issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
      traceId: ctx.traceId,
    });
  }

  const existing =
    (await deps.settings.findByUserId(ctx.userId)) ??
    defaultUserSettings(ctx.userId, nowIso(deps));
  assertUserScope(ctx.userId, existing.userId);

  const patch = parsed.data;
  const updated: UserSettings = {
    ...existing,
    ...(patch.autonomyDefaults !== undefined
      ? { autonomyDefaults: { ...existing.autonomyDefaults, ...patch.autonomyDefaults } }
      : {}),
    ...(patch.quietHours !== undefined ? { quietHours: patch.quietHours } : {}),
    ...(patch.briefingSchedule !== undefined ? { briefingSchedule: patch.briefingSchedule } : {}),
    ...(patch.sourcePrefs !== undefined
      ? { sourcePrefs: { ...existing.sourcePrefs, ...patch.sourcePrefs } }
      : {}),
    ...(patch.dataUseOptIns !== undefined
      ? { dataUseOptIns: { ...existing.dataUseOptIns, ...patch.dataUseOptIns } }
      : {}),
    updatedAt: nowIso(deps),
  };

  const saved = await deps.settings.save(userSettingsSchema.parse(updated));
  return ok(saved);
}

/**
 * DELETE /v1/me — the sample Yellow route (api-spec.md: hard delete requires a
 * confirmation ApprovalToken). Compose with withCapabilityGate('me.delete', ...) —
 * this bare handler must never be routed directly.
 */
export async function deleteMe(
  ctx: RequestContext,
  deps: IdentityDeps,
): Promise<HandlerResponse<{ deleted: true }>> {
  await deps.lifecycle.hardDelete(ctx.userId);
  return ok({ deleted: true });
}
