import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import type { AuthProvider } from './auth-provider.js';
import type { RequestContext } from './request-context.js';

/**
 * DevAuthProvider — verifies a locally-signed HS256 JWT using DEV_AUTH_SECRET.
 * Default for local/CI/tests. Never use in production.
 *
 * Token format: HS256 JWT with claims { sub: userId, traceId }.
 * Mint helper: DevAuthProvider.mint(userId) for tests.
 */
export class DevAuthProvider implements AuthProvider {
  private readonly secret: Uint8Array;

  constructor(devAuthSecret: string) {
    this.secret = new TextEncoder().encode(devAuthSecret);
  }

  /** Mint a dev token for the given userId (test helper). */
  static async mint(userId: string, secret: string): Promise<string> {
    const enc = new TextEncoder().encode(secret);
    return new SignJWT({ sub: userId, traceId: randomUUID() })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(enc);
  }

  async verify(token: string): Promise<RequestContext | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ['HS256'] });
      const userId = payload.sub;
      if (!userId || typeof userId !== 'string') return null;
      return {
        userId,
        traceId: (payload.traceId as string) ?? randomUUID(),
        headers: {},
      };
    } catch {
      return null;
    }
  }
}