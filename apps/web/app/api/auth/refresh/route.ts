import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getServerAuthProvider,
  SESSION_COOKIE_NAME,
  sessionCookieAttrs,
} from '@/auth';

/**
 * `POST /api/auth/refresh` — the 401→refresh-once bridge.
 *
 * When the API client sees a 401 on a call that just used a bearer, it
 * asks the SessionProvider to force-refresh. The provider hits this route,
 * which:
 *
 *   1. Reads the existing session cookie (httpOnly).
 *   2. Verifies it via the server auth provider.
 *   3. Mints a fresh token for the same userId and re-sets the cookie.
 *   4. Returns `{ token }` so the client can immediately retry its call.
 *
 * If the current cookie is missing or already expired, we return 401 and
 * the SessionProvider redirects to `/sign-in`. In FM1 (dev provider) we
 * can re-mint straight from userId; Clerk (later) will delegate to its own
 * refresh endpoint.
 */
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const existing = cookies().get(SESSION_COOKIE_NAME)?.value ?? null;
  if (existing === null || existing.length === 0) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const provider = getServerAuthProvider();
  const userId = await provider.verifyToken(existing);
  if (userId === null) {
    // Expired / invalid — can't refresh without a fresh sign-in.
    return NextResponse.json({ error: 'expired' }, { status: 401 });
  }

  if (provider.kind !== 'dev') {
    // Clerk refresh is not wired in FM1 — bounce to sign-in so the user
    // re-authenticates via Clerk's flow.
    return NextResponse.json({ error: 'refresh_not_wired' }, { status: 401 });
  }

  const token = await provider.mintToken(userId);
  const attrs = sessionCookieAttrs();
  const response = NextResponse.json({ token });
  response.cookies.set({
    name: attrs.name,
    value: token,
    httpOnly: attrs.httpOnly,
    sameSite: attrs.sameSite,
    path: attrs.path,
    secure: attrs.secure,
    maxAge: attrs.maxAge,
  });
  return response;
}