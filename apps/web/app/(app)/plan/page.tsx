import { PlanRoomClient } from './PlanRoomClient';

/** Strategy Plan room — grounded, advisory plans from GET /v1/cie/plans. */
export default function PlanPage(): JSX.Element {
  return (
    <section aria-labelledby="plan-heading" className="flex flex-col gap-5">
      <header>
        <h1 id="plan-heading" className="text-2xl font-semibold text-text-primary">Plan</h1>
        <p className="mt-1 text-text-secondary">Grounded next actions and milestones traced to your real goals, profile, and pipeline.</p>
      </header>
      <PlanRoomClient />
    </section>
  );
}