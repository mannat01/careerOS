import { ApprovalsRoomClient } from './ApprovalsRoomClient';

/** Approvals room — caller-scoped server truth for Yellow actions. */
export default function ApprovalsPage(): JSX.Element {
  return (
    <section aria-labelledby="approvals-heading" className="flex flex-col gap-4">
      <h1 id="approvals-heading" className="text-2xl font-semibold text-text-primary">
        Approvals
      </h1>
      <p className="text-text-secondary">
        Prepared Yellow actions waiting for your review before execution.
      </p>
      <ApprovalsRoomClient />
    </section>
  );
}
