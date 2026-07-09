import { enforce, type EnforceDeps } from '@careeros/capability-gate';
import { errorResponse, type HandlerResponse } from '../errors/http-error.js';
import type { RequestContext } from '../auth/request-context.js';

/**
 * API-side capability-gate wrapper (the future NestJS interceptor delegates here —
 * apps/api/common/capability-gate per project-structure.md §3). Wraps a handler for
 * a side-effecting route: enforcement runs BEFORE the handler; on deny the handler
 * body is never invoked and the client gets the shared `capability_denied` error.
 *
 * The Yellow approval token arrives via the `X-Approval-Token` header (api-spec.md §3)
 * and is bound to (userId, action, payloadHash) — payload here is the exact request
 * payload the side effect will run with.
 */
export function withCapabilityGate<TPayload, TResult>(
  action: string,
  deps: EnforceDeps,
  handler: (ctx: RequestContext, payload: TPayload) => Promise<HandlerResponse<TResult>>,
): (ctx: RequestContext, payload: TPayload) => Promise<HandlerResponse<TResult>> {
  return async (ctx, payload) => {
    const decision = await enforce(
      {
        userId: ctx.userId,
        action,
        payload,
        approvalToken: ctx.headers['x-approval-token'],
        actor: 'user',
        traceId: ctx.traceId,
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
