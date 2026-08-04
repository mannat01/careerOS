/**
 * You room — profile, settings, autonomy defaults. FM1 empty-state only.
 */
export default function YouPage(): JSX.Element {
  return (
    <section aria-labelledby="you-heading" className="flex flex-col gap-4">
      <h1 id="you-heading" className="text-2xl font-semibold text-text-primary">
        You
      </h1>
      <p className="text-text-secondary">
        Your profile, preferences, and autonomy defaults.
      </p>
      <div
        role="status"
        className="rounded-lg border border-dashed border-border-subtle bg-bg-elevated p-6 text-center text-text-muted"
      >
        <p className="text-sm">
          Profile editing arrives in a later batch. For now, this room is
          your future home for identity, settings, and tier controls.
        </p>
      </div>
    </section>
  );
}