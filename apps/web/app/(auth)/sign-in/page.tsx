import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getServerAuthProvider, sessionCookieAttrs } from '@/auth';

/**
 * `/sign-in` — dev sign-in page.
 *
 * FM1 ships the dev flow: the user posts an email; the server mints a
 * dev-JWT for a deterministic userId, sets the httpOnly session cookie, and
 * redirects to `/today`. Prod (Clerk) sign-in lands in a later batch — the
 * Clerk provider stub is not wired.
 *
 * The form uses a Next.js **server action** so the browser never sees the
 * secret key or the raw JWT (both stay on the server).
 */
export default function SignInPage(): JSX.Element {
  async function signInAction(formData: FormData): Promise<void> {
    'use server';
    const emailRaw = formData.get('email');
    const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : '';
    if (email.length === 0 || !email.includes('@')) {
      // Bounce back to sign-in with a query flag; the page reads it below.
      redirect('/sign-in?error=invalid_email');
    }

    // Derive a stable, deterministic userId from the email so repeat sign-ins
    // land on the same account. Real hashing lives in FM2's onboarding flow;
    // here we just prefix the local-part.
    const userId = `dev-${email.replace(/[^a-z0-9]+/g, '-')}`;

    const provider = getServerAuthProvider();
    if (provider.kind !== 'dev') {
      // Prod (Clerk) sign-in is intentionally not wired in FM1. Fail loud
      // rather than silently rendering the dev form against a Clerk backend.
      throw new Error('Dev sign-in is only available when AUTH_PROVIDER=dev.');
    }
    const token = await provider.mintToken(userId);

    const attrs = sessionCookieAttrs();
    cookies().set({
      name: attrs.name,
      value: token,
      httpOnly: attrs.httpOnly,
      sameSite: attrs.sameSite,
      path: attrs.path,
      secure: attrs.secure,
      maxAge: attrs.maxAge,
    });

    redirect('/today');
  }

  return (
    <section aria-labelledby="sign-in-heading" className="flex flex-col gap-6">
      <div>
        <h1 id="sign-in-heading" className="text-2xl font-semibold text-text-primary">
          Sign in
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Dev sign-in. Enter any email to get a scoped session for local use.
        </p>
      </div>
      <form action={signInAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-secondary">Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-base"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-brand-base px-3 py-2 text-sm font-medium text-text-inverse transition-colors duration-fast hover:bg-brand-emphasis"
        >
          Continue
        </button>
      </form>
      <p className="text-xs text-text-muted">
        Production sign-in uses Clerk and is not wired in this build.
      </p>
    </section>
  );
}