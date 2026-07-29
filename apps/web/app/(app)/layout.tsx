import type { ReactNode } from 'react';

/**
 * `(app)` route group — authenticated shell. Rooms (Today / Applications /
 * Portfolio / Studio / Settings) mount as children here. Auth guard and Trust
 * Kit surfaces are added by FM1 tasks 6 & Batch C respectively.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr] bg-bg-base">
      <header className="border-b border-border-subtle bg-bg-elevated px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span className="font-semibold text-text-primary">CareerOS</span>
          {/* Trust Kit surfaces (autonomy tier chip, quiet-mode toggle, audit link) mount here in Batch C. */}
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-6 py-6">{children}</main>
    </div>
  );
}