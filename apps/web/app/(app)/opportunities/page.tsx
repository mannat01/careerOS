/**
 * Opportunities room — the pipeline of live opportunities the twin is
 * tracking. FM1 ships the empty-state; FM3 wires the actual list.
 */
export default function OpportunitiesPage(): JSX.Element {
  return (
    <section aria-labelledby="opportunities-heading" className="flex flex-col gap-4">
      <h1 id="opportunities-heading" className="text-2xl font-semibold text-text-primary">
        Opportunities
      </h1>
      <p className="text-text-secondary">
        Roles your twin is watching, ranked by fit and momentum.
      </p>
      <div
        role="status"
        className="rounded-lg border border-dashed border-border-subtle bg-bg-elevated p-6 text-center text-text-muted"
      >
        <p className="text-sm">
          No opportunities yet. Your twin will surface fits here as it learns
          what you&rsquo;re looking for.
        </p>
      </div>
    </section>
  );
}