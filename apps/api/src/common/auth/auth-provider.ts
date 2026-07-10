import type { RequestContext } from './request-context.js';

/**
 * Auth provider interface — resolves a bearer token into a verified RequestContext.
 * Implementations are selected by AUTH_PROVIDER env (dev|clerk|workos).
 */
export interface AuthProvider {
  /** Verify the bearer token and return a RequestContext, or null if invalid. */
  verify(token: string): Promise<RequestContext | null>;
}