/**
 * Authenticated request context. Produced by the auth guard (DevAuthProvider or
 * ClerkAuthProvider) from a bearer token. Handlers NEVER trust ids from the
 * body/query — only from this context.
 */
export interface RequestContext {
  /** Resolved, verified user id — the row-scope for every query. */
  userId: string;
  traceId: string;
  /** Lower-cased header map (only what handlers need). */
  headers: Readonly<Record<string, string | undefined>>;
}

/** Construct a context from already-verified claims (used by auth providers + tests). */
export function contextFromVerifiedClaims(claims: { userId: string; traceId: string; headers?: Record<string, string | undefined> }): RequestContext {
  return { userId: claims.userId, traceId: claims.traceId, headers: claims.headers ?? {} };
}
