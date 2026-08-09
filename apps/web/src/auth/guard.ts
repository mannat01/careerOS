import type { MeResponse } from '@careeros/contracts';
import { ApiError } from '../api/errors';
import type { ServerAuthProvider } from './types';

export type AuthenticatedRouteDecision =
  | { kind: 'unauthenticated' }
  | { kind: 'onboarding_required'; me: MeResponse }
  | { kind: 'ready'; me: MeResponse }
  | { kind: 'dependency_error'; error: ApiError };

export type AuthenticatedRouteAction =
  | { kind: 'redirect'; to: '/sign-in' | '/onboarding' | '/today' }
  | { kind: 'render_app'; me: MeResponse }
  | { kind: 'render_onboarding'; me: MeResponse }
  | { kind: 'render_recovery'; error: ApiError };

export interface GuardDeps {
  authProvider: ServerAuthProvider;
  readSessionCookie: () => string | null;
  bootstrap: (token: string) => Promise<MeResponse>;
  refresh: (token: string) => Promise<string | null>;
}

/** Exhaustive backend-owned route decision. No resource/timestamp inference exists here. */
export async function evaluateAuthenticatedRoute(
  deps: GuardDeps,
): Promise<AuthenticatedRouteDecision> {
  const token = deps.readSessionCookie();
  if (!token) return { kind: 'unauthenticated' };

  try {
    if (await deps.authProvider.verifyToken(token) === null) return { kind: 'unauthenticated' };
  } catch (cause) {
    return { kind: 'dependency_error', error: dependencyError(cause) };
  }

  let currentToken = token;
  let refreshed = false;
  for (;;) {
    try {
      const me = await deps.bootstrap(currentToken);
      switch (me.onboarding.status) {
        case 'required': return { kind: 'onboarding_required', me };
        case 'complete': return { kind: 'ready', me };
        default: {
          const exhaustive: never = me.onboarding;
          return exhaustive;
        }
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'unauthenticated' && !refreshed) {
        refreshed = true;
        let next: string | null;
        try {
          next = await deps.refresh(currentToken);
        } catch (refreshCause) {
          return { kind: 'dependency_error', error: dependencyError(refreshCause) };
        }
        if (next !== null) {
          currentToken = next;
          continue;
        }
        return { kind: 'unauthenticated' };
      }
      if (cause instanceof ApiError && cause.code === 'unauthenticated') {
        return { kind: 'unauthenticated' };
      }
      return {
        kind: 'dependency_error',
        error: cause instanceof ApiError ? cause : dependencyError(cause),
      };
    }
  }
}

/** Maps one decision to either the normal app guard or inverse onboarding guard. */
export function actionForAuthenticatedRoute(
  decision: AuthenticatedRouteDecision,
  route: 'app' | 'onboarding',
): AuthenticatedRouteAction {
  switch (decision.kind) {
    case 'unauthenticated': return { kind: 'redirect', to: '/sign-in' };
    case 'dependency_error': return { kind: 'render_recovery', error: decision.error };
    case 'onboarding_required':
      return route === 'app'
        ? { kind: 'redirect', to: '/onboarding' }
        : { kind: 'render_onboarding', me: decision.me };
    case 'ready':
      return route === 'app'
        ? { kind: 'render_app', me: decision.me }
        : { kind: 'redirect', to: '/today' };
    default: {
      const exhaustive: never = decision;
      return exhaustive;
    }
  }
}

function dependencyError(cause: unknown): ApiError {
  return new ApiError({
    code: 'internal',
    message: cause instanceof Error ? cause.message : 'Identity dependency failed.',
  });
}