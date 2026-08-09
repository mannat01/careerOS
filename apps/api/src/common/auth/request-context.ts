/**
 * Authenticated request context. Produced by the auth guard (DevAuthProvider or
 * ClerkAuthProvider) from a bearer token. Handlers NEVER trust ids from the
 * body/query — only from this context.
 */
export interface RequestContext {
  /** Server-derived database row id — the row-scope for every query. */
  userId: string;
  /** Stable identity verified by the configured provider, independent of DB lookup. */
  identity: {
    provider: 'dev' | 'clerk';
    subject: string;
    email: string | null;
  };
  traceId: string;
  /** Lower-cased header map (only what handlers need). */
  headers: Readonly<Record<string, string | undefined>>;
}

/** Construct a context from already-verified claims (used by auth providers + tests). */
export function contextFromVerifiedClaims(claims: {
  userId: string;
  traceId: string;
  provider?: 'dev' | 'clerk';
  providerSubject?: string;
  email?: string | null;
  headers?: Record<string, string | undefined>;
}): RequestContext {
  return {
    userId: claims.userId,
    identity: {
      provider: claims.provider ?? 'dev',
      subject: claims.providerSubject ?? claims.userId,
      email: claims.email ?? null,
    },
    traceId: claims.traceId,
    headers: claims.headers ?? {},
  };
}
