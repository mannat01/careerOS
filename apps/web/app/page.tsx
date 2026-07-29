import Link from 'next/link';

/**
 * Root landing — for FM1 this just links into the authenticated shell (Today
 * room) via the `(app)` route group. FM2 replaces this with the marketing home.
 */
export default function RootPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <h1 className="text-4xl font-semibold">CareerOS</h1>
      <p className="text-text-secondary">
        Your career, run intentionally.
      </p>
      <p className="text-text-muted text-sm">
        FM1 scaffold — the authenticated shell lives under <code>/today</code>.
      </p>
      <Link
        href="/today"
        className="w-fit rounded-md bg-brand-base px-4 py-2 text-text-inverse transition-colors duration-fast hover:bg-brand-emphasis"
      >
        Open the app
      </Link>
    </main>
  );
}