import type { AutonomyTier } from '@careeros/contracts';
import { enforce, type EnforceDeps } from '@careeros/capability-gate';
import { errorResponse, type HandlerResponse } from '../errors/http-error.js';
import type { RequestContext } from '../auth/request-context.js';

/**
 * Per-user autonomy-tier lookup: given a userId + action, resolve the user's
 * override from `UserSettings.autonomyDefaults`. The interceptor passes the
 * result to enforce() as `userTierOverride`; the gate's tightening-only rule
 * ensures a user can never LOOSEN the registry floor — only raise it (M07).
 *
 * A `null` / `undefined` result means "no per-user override, use the registry
 * tier". Failures MUST fail closed at the call site (throw) — the interceptor
 * treats a resolver throw as `capability_denied` with reason `resolver_error`.
 */
export type UserAutonomyResolver = (
  userId: string,
  action: string,
) => Promise<AutonomyTier | undefined>;

/**
 * API-side capability-gate wrapper (the future NestJS interceptor delegates here —
 * apps/api/common/capability-gate per project-structure.md §3). Wraps a handler for
 * a side-effecting route: enforcement runs BEFORE the handler; on deny the handler
 * body is never invoked and the client gets the shared `capability_denied` error.
 *
 * The Yellow approval token arrives via the `X-Approval-Token` header (api-spec.md §3)
 * and is bound to (userId, action, payloadHash) — payload here is the exact request
 * payload the side effect will run with.
 *
 * If `resolveUserTier` is provided the interceptor consults it BEFORE enforcement
 * so the user's `autonomyDefaults[action]` override is honored end-to-end. Wiring
 * this in the composition root is what makes autonomy tiers LIVE (M07 Step 5).
 */
export function withCapabilityGate<TPayload, TResult>(
  action: string,
  deps: EnforceDeps,
  handler: (ctx: RequestContext, payload: TPayload) => Promise<HandlerResponse<TResult>>,
  resolveUserTier?: UserAutonomyResolver,
): (ctx: RequestContext, payload: TPayload) => Promise<HandlerResponse<TResult>> {
  return async (ctx, payload) => {
    let userTierOverride: AutonomyTier | undefined;
    if (resolveUserTier) {
      try {
        userTierOverride = await resolveUserTier(ctx.userId, action);
      } catch {
        // Fail closed — a resolver error MUST NOT accidentally allow the action.
        return errorResponse(
          'capability_denied',
          `Action '${action}' requires approval (resolver_error).`,
          {
            details: { action, reason: 'resolver_error' },
            traceId: ctx.traceId,
          },
        );
      }
    }

    const decision = await enforce(
      {
        userId: ctx.userId,
        action,
        payload,
        approvalToken: ctx.headers['x-approval-token'],
        actor: 'user',
        traceId: ctx.traceId,
        userTierOverride,
      },
      deps,
    );

    if (!decision.allowed) {
      return errorResponse('capability_denied', `Action '${action}' requires approval (${decision.reason}).`, {
        details: { action, reason: decision.reason },
        traceId: ctx.traceId,
      });
    }

    return handler(ctx, payload);
  };
}
