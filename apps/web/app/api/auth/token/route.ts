import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getServerAuthProvider, SESSION_COOKIE_NAME } from '@/auth';

/**
 * `POST /api/auth/token` — the client-side bridge that hands the API client
 * a bearer token WITHOUT exposing the httpOnly session cookie to JS.
 *
 * The browser can't read httpOnly cookies (that's the point — XSS-safe),
 * so the SessionProvider fetches this endpoint (same-origin, credentials:
 * include) and receives `{ token }`. The API client then attaches it to
 * outbound `Authorization: Bearer …` headers.
 *
 * Rejects with 401 if the cookie is missing or the token no longer verifies
 * (expired, wrong signature). The client treats 401 here as "signed out"
 * and redirects to `/sign-in`.
 */
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value ?? null;
  if (token === null || token.length === 0) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const provider = getServerAuthProvider();
  const userId = await provider.verifyToken(token);
  if (userId === null) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }

  // Return the raw bearer. The Set-Cookie contract keeps this same-origin;
  // callers must NOT store the token beyond the current page lifecycle.
  return NextResponse.json({ token });
}