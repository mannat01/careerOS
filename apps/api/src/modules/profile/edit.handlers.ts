import {
  profileFactEditRequestSchema,
  profileFactEditResponseSchema,
  type ProfileFactEditResponse,
  type ProfileFactKind,
} from '@careeros/contracts';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';
import type { ProfileRepo } from './repos.js';

export interface ProfileFactEditMemoryPort {
  recordProfileFactEdit(input: {
    userId: string;
    profileId: string;
    factId: string;
    kind: ProfileFactKind;
    beforeLabel: string;
    afterLabel: string;
  }): Promise<void>;
}

export interface ProfileFactEditDeps {
  profiles: ProfileRepo;
  /** Required: a successful authoritative edit must append its user-decision event. */
  memory: ProfileFactEditMemoryPort;
}

/**
 * PATCH /v1/profile/facts/:id — authoritative correction of an existing fact.
 * Ownership is derived solely from ctx.userId; a missing or cross-user id is the
 * same 404 so fact existence is never disclosed across users.
 */
export async function editProfileFact(
  ctx: RequestContext,
  factId: string,
  body: unknown,
  deps: ProfileFactEditDeps,
): Promise<HandlerResponse<ProfileFactEditResponse>> {
  const parsed = profileFactEditRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('validation_failed', 'Invalid profile fact edit.', {
      details: { issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) },
      traceId: ctx.traceId,
    });
  }

  const updated = await deps.profiles.updateFact(ctx.userId, factId, parsed.data);
  if (!updated) {
    return errorResponse('not_found', 'Profile fact not found.', { traceId: ctx.traceId });
  }

  await deps.memory.recordProfileFactEdit({
    userId: ctx.userId,
    profileId: updated.profileId,
    factId: updated.fact.id,
    kind: updated.fact.kind,
    beforeLabel: updated.beforeLabel,
    afterLabel: updated.fact.label,
  });

  return ok(profileFactEditResponseSchema.parse({ fact: updated.fact }));
}