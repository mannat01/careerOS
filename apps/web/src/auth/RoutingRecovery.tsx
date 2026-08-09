import type { ApiError } from '../api/errors';

/** Visible, accessible route-level dependency recovery. Never redirects identity failures. */
export function RoutingRecovery({ error, retryHref }: {
  error: ApiError;
  retryHref: string;
}): JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 px-6">
      <section role="alert" data-testid="routing-recovery" className="rounded-md border border-border-subtle bg-bg-subtle p-4">
        <h1 className="text-xl font-semibold text-text-primary">We couldn&rsquo;t load your account</h1>
        <p className="mt-2 text-text-secondary">{error.message}</p>
        {error.traceId ? <p className="mt-2 text-xs text-text-muted">Trace id: <code>{error.traceId}</code></p> : null}
        <a href={retryHref} className="mt-4 inline-block rounded-md border border-brand-base px-3 py-2 text-brand-base focus-visible:ring-2 focus-visible:ring-brand-base">
          Try again
        </a>
      </section>
    </main>
  );
}