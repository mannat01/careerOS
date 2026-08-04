/**
 * Approvals room — the Yellow-tier action queue. FM1 empty-state only;
 * FM4 wires the SSE-driven list + ApprovalDialog surfaces.
 */
export default function ApprovalsPage(): JSX.Element {
  return (
    <section aria-labelledby="approvals-heading" className="flex flex-col gap-4">
      <h1 id="approvals-heading" className="text-2xl font-semibold text-text-primary">
        Approvals
      </h1>
      <p className="text-text-secondary">
        Actions your twin has prepared for you to review before sending.
      </p>
      <div
        role="status"
        className="rounded-lg border border-dashed border-border-subtle bg-bg-elevated p-6 text-center text-text-muted"
      >
        <p className="text-sm">
          No pending approvals. When your twin needs a green light, the
          item lands here and the badge in the nav lights up.
        </p>
      </div>
    </section>
  );
}