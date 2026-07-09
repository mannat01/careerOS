/**
 * Authenticated request context. In production this is produced by the managed-auth
 * guard (Clerk per master-plan; bearer token → userId). Handlers NEVER trust ids
 * from the body/query — only from this context.
 */
export interface RequestContext {
  /** Resolved, verified user id — the row-scope for every query. */
  userId: string;
  traceId: string;
  /** Lower-cased header map (only what handlers need). */
  headers: Readonly<Record<string, string | undefined>>;
}

// STUB(M01): stands in for the managed-auth provider integration (Clerk/WorkOS
// NestJS guard verifying the bearer token). Tests construct contexts directly.
export function contextFromVerifiedClaims(claims: { userId: string; traceId: string; headers?: Record<string, string | undefined> }): RequestContext {
  return { userId: claims.userId, traceId: claims.traceId, headers: claims.headers ?? {} };
}
