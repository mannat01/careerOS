import type { ReactNode } from 'react';

/**
 * `(auth)` route group — sign-in / sign-up flows. Provider-agnostic wrapper;
 * the actual UI is added by FM1 task 6. Placeholder in FM1 scaffold.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      {children}
    </main>
  );
}