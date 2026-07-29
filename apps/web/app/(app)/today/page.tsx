/**
 * Today room — the CIE surface: today's cards, capacity, focus. Populated by
 * FM4. This FM1 placeholder just proves the `(app)` route group renders.
 */
export default function TodayPage() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-text-primary">Today</h1>
      <p className="text-text-secondary">
        Your daily focus, capacity, and next-best actions land here.
      </p>
      <div className="rounded-lg border border-border-subtle bg-bg-elevated p-4 text-text-muted">
        FM1 scaffold placeholder — the CIE Today feed wires in FM4.
      </div>
    </section>
  );
}