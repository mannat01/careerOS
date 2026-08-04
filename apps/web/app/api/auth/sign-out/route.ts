import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/auth';

/**
 * `POST /api/auth/sign-out` — clear the session cookie so the next server
 * render bounces the user back to `/sign-in`.
 *
 * We intentionally do NOT invalidate the JWT server-side (dev tokens are
 * stateless HS256). Because they're short-lived and only valid via the
 * cookie, deleting the cookie is sufficient for FM1's threat model.
 */
export const dynamic = 'force-dynamic';

export function POST(): NextResponse {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}