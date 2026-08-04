/**
 * Plan room — capacity, skill plan, calibration. FM1 empty-state only.
 */
export default function PlanPage(): JSX.Element {
  return (
    <section aria-labelledby="plan-heading" className="flex flex-col gap-4">
      <h1 id="plan-heading" className="text-2xl font-semibold text-text-primary">
        Plan
      </h1>
      <p className="text-text-secondary">
        Your capacity, skill plan, and weekly calibration cadence.
      </p>
      <div
        role="status"
        className="rounded-lg border border-dashed border-border-subtle bg-bg-elevated p-6 text-center text-text-muted"
      >
        <p className="text-sm">
          Nothing planned yet. As your twin learns your goals, weekly plans
          appear here for you to accept or edit.
        </p>
      </div>
    </section>
  );
}