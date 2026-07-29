import type { ReactNode } from 'react';

/**
 * `(marketing)` route group — public, unauthenticated surfaces (landing page,
 * public portfolio `/p/[slug]` in V2). No auth guard; no personalised data.
 * Placeholder in FM1; populated by FM5.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}