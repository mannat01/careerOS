import { PlanRoomClient } from './PlanRoomClient';
import Link from 'next/link';

/** Strategy Plan room — grounded, advisory plans from GET /v1/cie/plans. */
export default function PlanPage(): JSX.Element {
  return (
    <section aria-labelledby="plan-heading" className="flex flex-col gap-5">
      <header>
        <h1 id="plan-heading" className="text-2xl font-semibold text-text-primary">Plan</h1>
        <p className="mt-1 text-text-secondary">Grounded next actions and milestones traced to your real goals, profile, and pipeline.</p>
        <nav aria-label="Plan analysis rooms" className="mt-3 flex flex-wrap gap-4 text-sm font-semibold">
          <Link href="/plan/skills" className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Open Skills analysis</Link>
          <Link href="/plan/dashboards" className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Open Dashboards</Link>
        </nav>
      </header>
      <PlanRoomClient />
    </section>
  );
}