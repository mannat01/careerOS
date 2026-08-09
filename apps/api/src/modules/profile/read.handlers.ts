import { profileResponseSchema, type ProfileResponse } from '@careeros/contracts';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';
import type { ProfileRepo } from './repos.js';

export async function getProfile(
  ctx: RequestContext,
  profiles: ProfileRepo,
): Promise<HandlerResponse<ProfileResponse>> {
  try {
    const profile = await profiles.findByUserId(ctx.userId);
    if (profile === null) {
      return errorResponse('not_found', 'Profile not found.', { traceId: ctx.traceId });
    }
    return ok(profileResponseSchema.parse(profile));
  } catch {
    return errorResponse('internal', 'Profile dependency failed.', { traceId: ctx.traceId });
  }
}