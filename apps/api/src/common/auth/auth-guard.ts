import type { AuthProvider } from './auth-provider.js';
import type { RequestContext } from './request-context.js';

/**
 * Auth guard — resolves a bearer token via the configured AuthProvider.
 * Returns a RequestContext on success, or null (unauthenticated).
 */
export async function resolveBearerToken(
  authHeader: string | undefined,
  provider: AuthProvider,
): Promise<RequestContext | null> {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return null;
  return provider.verify(match[1]!);
}