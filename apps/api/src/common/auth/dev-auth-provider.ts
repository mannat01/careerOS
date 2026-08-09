import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomUUID } from 'node:crypto';
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
  static async mint(userId: string, secret: string, email?: string): Promise<string> {
    const enc = new TextEncoder().encode(secret);
    return new SignJWT({ sub: userId, traceId: randomUUID(), ...(email ? { email } : {}) })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(enc);
  }

  async verify(token: string): Promise<RequestContext | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ['HS256'] });
      const subject = payload.sub;
      if (!subject || typeof subject !== 'string') return null;
      const userId = subjectToUserId('dev', subject);
      return {
        userId,
        identity: {
          provider: 'dev',
          subject,
          email: typeof payload.email === 'string' ? payload.email : null,
        },
        traceId: (payload.traceId as string) ?? randomUUID(),
        headers: {},
      };
    } catch {
      return null;
    }
  }
}

/** Stable provider principal → internal UUID mapping; UUID subjects remain unchanged. */
export function subjectToUserId(provider: 'dev' | 'clerk', subject: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(subject)) {
    return subject.toLowerCase();
  }
  const bytes = createHash('sha256').update(`${provider}|${subject}`, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}