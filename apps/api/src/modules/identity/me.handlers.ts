import {
  defaultUserSettings,
  meResponseSchema,
  onboardingCompletionRequestSchema,
  onboardingCompletionResponseSchema,
  onboardingStateFromCompletedAt,
  updateUserSettingsRequestSchema,
  userSettingsSchema,
  type MeResponse,
  type OnboardingCompletionResponse,
  type UserSettings,
} from '@careeros/contracts';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';
import type { RequestContext } from '../../common/auth/request-context.js';
import { assertUserScope } from '../../common/auth/scope.js';
import type {
  IdentityBootstrapRepo,
  OnboardingCompletionRepo,
  UserLifecycleRepo,
  UserRepo,
  UserSettingsRepo,
} from './repos.js';

export interface IdentityDeps {
  users: UserRepo;
  settings: UserSettingsRepo;
  lifecycle: UserLifecycleRepo;
  bootstrap: IdentityBootstrapRepo;
  completion: OnboardingCompletionRepo;
  clock?: () => Date;
}

const nowIso = (deps: IdentityDeps): string => (deps.clock ?? (() => new Date()))().toISOString();

/** GET /v1/me — a read only. Account creation belongs exclusively to bootstrap. */
export async function getMe(
  ctx: RequestContext,
  deps: IdentityDeps,
): Promise<HandlerResponse<MeResponse>> {
  try {
    const user = await deps.users.findById(ctx.userId);
    if (user === null) {
      return errorResponse('not_found', 'User not found.', { traceId: ctx.traceId });
    }
    assertUserScope(ctx.userId, user.id);

    const settings = await deps.settings.findByUserId(ctx.userId);
    if (settings === null) {
      return errorResponse('internal', 'Account settings are unavailable.', { traceId: ctx.traceId });
    }

    return ok(meResponseSchema.parse({
      user,
      settings,
      onboarding: onboardingStateFromCompletedAt(user.onboardingCompletedAt),
    }));
  } catch {
    return errorResponse('internal', 'Identity dependency failed.', { traceId: ctx.traceId });
  }
}

/** POST /v1/me/bootstrap — idempotent first-run account/settings creation (Green). */
export async function bootstrapMe(
  ctx: RequestContext,
  _body: unknown,
  deps: IdentityDeps,
): Promise<HandlerResponse<MeResponse>> {
  try {
    const created = await deps.bootstrap.bootstrap({
      userId: ctx.userId,
      authProviderId: `${ctx.identity.provider}|${ctx.identity.subject}`,
      email: ctx.identity.email ?? `${ctx.userId}@${ctx.identity.provider}.careeros.local`,
      settings: defaultUserSettings(ctx.userId, nowIso(deps)),
    });
    return ok(meResponseSchema.parse(created));
  } catch {
    return errorResponse('internal', 'Identity bootstrap dependency failed.', {
      traceId: ctx.traceId,
    });
  }
}

/** POST /v1/me/onboarding/complete — idempotent Green completion write. */
export async function completeOnboarding(
  ctx: RequestContext,
  body: unknown,
  deps: IdentityDeps,
): Promise<HandlerResponse<OnboardingCompletionResponse>> {
  const parsed = onboardingCompletionRequestSchema.safeParse(body === undefined ? {} : body);
  if (!parsed.success) {
    return errorResponse('validation_failed', 'Invalid onboarding completion payload.', {
      details: { issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) },
      traceId: ctx.traceId,
    });
  }
  try {
    const result = await deps.completion.complete(ctx.userId, nowIso(deps));
    if (result.kind === 'profile_required') {
      return errorResponse('conflict', 'Import a résumé first.', {
        details: { prerequisite: 'profile_with_imported_fact' },
        traceId: ctx.traceId,
      });
    }
    return ok(onboardingCompletionResponseSchema.parse(result.me));
  } catch {
    return errorResponse('internal', 'Onboarding completion dependency failed.', {
      traceId: ctx.traceId,
    });
  }
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
